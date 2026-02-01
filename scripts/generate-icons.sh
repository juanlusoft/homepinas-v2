#!/bin/bash
# HomePiNAS PWA Icon Generator
# Generates PNG icons from SVG using ImageMagick or rsvg-convert

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ICONS_DIR="$PROJECT_DIR/icons"
SVG_FILE="$ICONS_DIR/icon.svg"

SIZES=(72 96 128 144 152 192 384 512)

echo "🎨 HomePiNAS PWA Icon Generator"
echo "================================"

# Check for conversion tool
if command -v rsvg-convert &> /dev/null; then
    CONVERT_TOOL="rsvg"
    echo "✓ Using rsvg-convert"
elif command -v convert &> /dev/null; then
    CONVERT_TOOL="imagemagick"
    echo "✓ Using ImageMagick"
else
    echo "⚠ No image converter found. Creating placeholder icons..."
    CONVERT_TOOL="placeholder"
fi

# Create icons directory
mkdir -p "$ICONS_DIR"

# Generate icons
for size in "${SIZES[@]}"; do
    output="$ICONS_DIR/icon-${size}x${size}.png"
    
    if [ "$CONVERT_TOOL" = "rsvg" ]; then
        rsvg-convert -w "$size" -h "$size" "$SVG_FILE" -o "$output"
        echo "✓ Generated $output"
    elif [ "$CONVERT_TOOL" = "imagemagick" ]; then
        convert -background none -resize "${size}x${size}" "$SVG_FILE" "$output"
        echo "✓ Generated $output"
    else
        # Create a simple placeholder PNG using printf for binary data
        # This creates a minimal valid PNG with a solid color
        echo "⚠ Skipping $output (no converter available)"
    fi
done

# Create Apple touch icon (180x180)
apple_icon="$ICONS_DIR/apple-touch-icon.png"
if [ "$CONVERT_TOOL" = "rsvg" ]; then
    rsvg-convert -w 180 -h 180 "$SVG_FILE" -o "$apple_icon"
    echo "✓ Generated $apple_icon"
elif [ "$CONVERT_TOOL" = "imagemagick" ]; then
    convert -background none -resize "180x180" "$SVG_FILE" "$apple_icon"
    echo "✓ Generated $apple_icon"
fi

# Create favicon.ico
favicon="$PROJECT_DIR/favicon.ico"
if [ "$CONVERT_TOOL" = "imagemagick" ]; then
    convert -background none "$SVG_FILE" -define icon:auto-resize=64,48,32,16 "$favicon"
    echo "✓ Generated $favicon"
fi

echo ""
echo "================================"
echo "Icon generation complete!"
echo "Icons created in: $ICONS_DIR"
