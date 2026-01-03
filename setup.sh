#!/bin/bash

# Confluence2Notion Extension - Setup Script
# Downloads required libraries and creates placeholder icons

echo "🚀 Setting up Confluence2Notion Extension..."

# Create directories
mkdir -p src/lib
mkdir -p assets

# Download Turndown.js
echo "📦 Downloading Turndown.js..."
curl -L -o src/lib/turndown.js "https://unpkg.com/turndown/dist/turndown.js"

# Download Turndown GFM Plugin
echo "📦 Downloading Turndown GFM Plugin..."
curl -L -o src/lib/turndown-plugin-gfm.js "https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js"

# Create placeholder icons (simple colored squares)
echo "🎨 Creating placeholder icons..."

# Create a simple SVG icon
cat > assets/icon.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="#2196F3"/>
  <text x="64" y="80" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="bold" fill="white">C2N</text>
</svg>
EOF

# Convert SVG to PNG using different methods
if command -v convert &> /dev/null; then
    # ImageMagick is installed
    echo "Converting icons with ImageMagick..."
    convert -background none assets/icon.svg -resize 16x16 assets/icon-16.png
    convert -background none assets/icon.svg -resize 48x48 assets/icon-48.png
    convert -background none assets/icon.svg -resize 128x128 assets/icon-128.png
elif command -v rsvg-convert &> /dev/null; then
    # librsvg is installed
    echo "Converting icons with rsvg-convert..."
    rsvg-convert -w 16 -h 16 assets/icon.svg > assets/icon-16.png
    rsvg-convert -w 48 -h 48 assets/icon.svg > assets/icon-48.png
    rsvg-convert -w 128 -h 128 assets/icon.svg > assets/icon-128.png
else
    echo "⚠️  No image converter found. Creating placeholder PNG files..."
    echo "   Please create your own icons or install ImageMagick/librsvg"
    
    # Create minimal 1x1 transparent PNGs as placeholders
    # These are base64 encoded minimal PNG files
    echo "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAADklEQVQ4jWNgGAWjAAMAABEAAVo=" | base64 -d > assets/icon-16.png
    echo "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAADklEQVRoge3BMQEAAADCoPVP7W8HoAAA8A0AAAD//2xhAAHHlJ3JAAAAAElFTkSuQmCC" | base64 -d > assets/icon-48.png  
    echo "iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAADklEQVR4nO3BMQEAAADCoPVP7WsIoAAAeAMAAP//LQAB/wAAAABJRU5ErkJggg==" | base64 -d > assets/icon-128.png
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Open Chrome and go to chrome://extensions"
echo "2. Enable 'Developer mode'"
echo "3. Click 'Load unpacked'"
echo "4. Select this folder"
echo ""
echo "⚠️  Note: You may want to replace the placeholder icons with proper ones."
