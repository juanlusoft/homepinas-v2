APP_NAME := HomePiNAS-Finder
LDFLAGS := -s -w
DIST := dist

.PHONY: all clean windows mac linux

all: windows mac linux

clean:
	rm -rf $(DIST)

$(DIST):
	mkdir -p $(DIST)

windows: $(DIST)
	GOOS=windows GOARCH=amd64 go build -ldflags="$(LDFLAGS) -H windowsgui" -o $(DIST)/$(APP_NAME)-windows-amd64.exe .

mac: $(DIST)
	GOOS=darwin GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o $(DIST)/$(APP_NAME)-macos-amd64 .
	GOOS=darwin GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o $(DIST)/$(APP_NAME)-macos-arm64 .

linux: $(DIST)
	GOOS=linux GOARCH=amd64 go build -ldflags="$(LDFLAGS)" -o $(DIST)/$(APP_NAME)-linux-amd64 .
	GOOS=linux GOARCH=arm64 go build -ldflags="$(LDFLAGS)" -o $(DIST)/$(APP_NAME)-linux-arm64 .
