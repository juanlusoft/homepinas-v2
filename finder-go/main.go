package main

import (
	"context"
	"crypto/tls"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

//go:embed web/index.html
var webFS embed.FS

// Device represents a discovered HomePiNAS device
type Device struct {
	IP       string `json:"ip"`
	Name     string `json:"name"`
	Hostname string `json:"hostname"`
	Version  string `json:"version"`
	Method   string `json:"method"`
}

func main() {
	// Find a free port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatal("Cannot find free port:", err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	mux := http.NewServeMux()

	// Serve the embedded HTML
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		data, _ := webFS.ReadFile("web/index.html")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})

	// API: scan network
	mux.HandleFunc("/api/scan", handleScan)

	// API: shutdown server
	mux.HandleFunc("/api/quit", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("bye"))
		go func() {
			time.Sleep(200 * time.Millisecond)
			os.Exit(0)
		}()
	})

	addr := fmt.Sprintf("127.0.0.1:%d", port)
	url := fmt.Sprintf("http://%s", addr)

	server := &http.Server{Addr: addr, Handler: mux}

	// Handle signals for clean shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		server.Shutdown(context.Background())
	}()

	fmt.Printf("HomePiNAS Finder running at %s\n", url)

	// Open browser
	go func() {
		time.Sleep(300 * time.Millisecond)
		openBrowser(url)
	}()

	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

func handleScan(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	devices := scanNetwork()

	json.NewEncoder(w).Encode(devices)
}

func scanNetwork() []Device {
	deviceMap := make(map[string]Device)
	var mu sync.Mutex

	var wg sync.WaitGroup

	// Method 1: mDNS/DNS-SD (scan common NAS names)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, d := range scanKnownHostnames() {
			mu.Lock()
			if _, exists := deviceMap[d.IP]; !exists {
				deviceMap[d.IP] = d
			}
			mu.Unlock()
		}
	}()

	// Method 2: Subnet scan on port 443
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, d := range scanSubnet() {
			mu.Lock()
			if _, exists := deviceMap[d.IP]; !exists {
				deviceMap[d.IP] = d
			}
			mu.Unlock()
		}
	}()

	wg.Wait()

	devices := make([]Device, 0, len(deviceMap))
	for _, d := range deviceMap {
		devices = append(devices, d)
	}
	return devices
}

func scanKnownHostnames() []Device {
	var devices []Device
	hostnames := []string{
		"pinas", "pinas.local",
		"homepinas", "homepinas.local",
		"nas", "nas.local",
		"pinasfinder", "pinasfinder.local",
	}

	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, hostname := range hostnames {
		wg.Add(1)
		go func(h string) {
			defer wg.Done()
			ips, err := net.LookupHost(h)
			if err != nil {
				return
			}
			for _, ip := range ips {
				// Skip IPv6
				if strings.Contains(ip, ":") {
					continue
				}
				if d := checkHomePiNAS(ip, h); d != nil {
					mu.Lock()
					devices = append(devices, *d)
					mu.Unlock()
				}
			}
		}(hostname)
	}

	wg.Wait()
	return devices
}

func scanSubnet() []Device {
	var devices []Device
	localIPs := getLocalIPs()

	for _, localIP := range localIPs {
		parts := strings.Split(localIP, ".")
		if len(parts) != 4 {
			continue
		}
		subnet := strings.Join(parts[:3], ".")

		var wg sync.WaitGroup
		var mu sync.Mutex

		// Scan 1-254 concurrently with a semaphore to limit connections
		sem := make(chan struct{}, 50)

		for i := 1; i <= 254; i++ {
			ip := fmt.Sprintf("%s.%d", subnet, i)
			if ip == localIP {
				continue
			}

			wg.Add(1)
			sem <- struct{}{}
			go func(target string) {
				defer wg.Done()
				defer func() { <-sem }()

				if d := checkHomePiNAS(target, ""); d != nil {
					mu.Lock()
					devices = append(devices, *d)
					mu.Unlock()
				}
			}(ip)
		}

		wg.Wait()
	}

	return devices
}

func checkHomePiNAS(ip, hostname string) *Device {
	// Check port 443 (HomePiNAS HTTPS)
	conn, err := net.DialTimeout("tcp", ip+":443", 1200*time.Millisecond)
	if err != nil {
		return nil
	}
	conn.Close()
	openPort := "443"

	client := &http.Client{
		Timeout: 3 * time.Second,
		Transport: &http.Transport{
			TLSHandshakeTimeout: 2 * time.Second,
			TLSClientConfig: &tls.Config{
				InsecureSkipVerify: true,
			},
		},
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse // Don't follow redirects
		},
	}

	// Try HTTPS first, then HTTP. Try multiple API endpoints.
	schemes := []string{"https", "http"}

	for _, scheme := range schemes {
		host := ip
		if openPort != "443" && openPort != "80" {
			host = ip + ":" + openPort
		}

		// Try /api/system/info first (the canonical endpoint)
		apiEndpoints := []string{"/api/system/info", "/api/auth/status"}
		for _, endpoint := range apiEndpoints {
			url := fmt.Sprintf("%s://%s%s", scheme, host, endpoint)
			resp, err := client.Get(url)
			if err != nil {
				continue
			}

			var bodyBytes []byte
			bodyBytes, _ = io.ReadAll(io.LimitReader(resp.Body, 4096))
			resp.Body.Close()

			var info struct {
				Product  string `json:"product"`
				Hostname string `json:"hostname"`
				Name     string `json:"name"`
				Version  string `json:"version"`
			}

			if json.Unmarshal(bodyBytes, &info) == nil {
				if info.Product == "HomePiNAS" || info.Hostname != "" {
					name := info.Hostname
					if name == "" {
						name = info.Name
					}
					if name == "" {
						name = hostname
					}
					if name == "" {
						name = "HomePiNAS"
					}
					return &Device{
						IP:       ip,
						Name:     name,
						Hostname: hostname,
						Version:  info.Version,
						Method:   "API",
					}
				}
			}
		}

		// Fallback: check if the root page contains "HomePiNAS" in HTML
		rootURL := fmt.Sprintf("%s://%s/", scheme, host)
		resp, err := client.Get(rootURL)
		if err != nil {
			continue
		}
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
		resp.Body.Close()

		bodyStr := strings.ToLower(string(bodyBytes))
		if strings.Contains(bodyStr, "homepinas") || strings.Contains(bodyStr, "homepinas finder") {
			name := hostname
			if name == "" {
				name = "HomePiNAS"
			}
			return &Device{
				IP:       ip,
				Name:     name,
				Hostname: hostname,
				Method:   "HTML",
			}
		}

		// If it responds on 443 with a web page, flag it as potential
		if resp.StatusCode == 200 || resp.StatusCode == 302 || resp.StatusCode == 401 {
			// Only flag if it looks like a local service (not a router admin page etc.)
			if strings.Contains(bodyStr, "pinas") || strings.Contains(bodyStr, "nas") ||
				resp.StatusCode == 401 {
				name := hostname
				if name == "" {
					name = fmt.Sprintf("NAS? (%s)", ip)
				}
				return &Device{
					IP:       ip,
					Name:     name,
					Hostname: hostname,
					Method:   "TCP",
				}
			}
		}
	}

	return nil
}

func getLocalIPs() []string {
	var ips []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return ips
	}

	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}
			ips = append(ips, ip.String())
		}
	}
	return ips
}
