#!/bin/bash
# setup.sh - Complete Setup Script

echo "🐟 Setting up NZ Fishing Predictor App..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 16+ from https://nodejs.org/"
    exit 1
fi

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    echo "❌ Node.js version 16 or higher required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js $(node -v) detected"

# Create project directory
mkdir -p nz-fishing-predictor
cd nz-fishing-predictor

# Create directory structure
mkdir -p public data logs

echo "📁 Created directory structure"

# Create package.json
cat > package.json << 'EOF'
{
  "name": "nz-fishing-predictor",
  "version": "1.0.0",
  "description": "Real-time marlin and tuna fishing predictions for New Zealand waters",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js",
    "build": "npm install",
    "test": "echo \"No tests yet\" && exit 0",
    "setup-db": "node setup-db.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "sqlite3": "^5.1.6",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "axios": "^1.6.0",
    "node-cron": "^3.0.3",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=16.0.0"
  }
}
EOF

# Create environment file
cat > .env << 'EOF'
PORT=3000
JWT_SECRET=nz-fishing-super-secret-key-change-in-production-2024
NODE_ENV=development

# API Keys (Sign up for free at these services)
NOAA_API_KEY=your_noaa_api_key_here
OPENWEATHER_API_KEY=your_openweather_api_key_here
COPERNICUS_API_KEY=your_copernicus_api_key_here

# Database
DATABASE_URL=./data/fishing_app.db
EOF

echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create database setup script
cat > setup-db.js << 'EOF'
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'fishing_app.db');
const db = new sqlite3.Database(dbPath);

console.log('🗄️  Setting up database...');

db.serialize(() => {
    // Create tables
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS environmental_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp DATETIME NOT NULL,
        sea_temperature REAL,
        current_speed REAL,
        current_direction INTEGER,
        chlorophyll REAL,
        wind_speed REAL,
        wind_direction INTEGER,
        wave_height REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS catch_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        species TEXT NOT NULL,
        weight REAL NOT NULL,
        length REAL,
        gear_type TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        depth REAL,
        water_temp REAL,
        time_caught DATETIME NOT NULL,
        notes TEXT,
        photo_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        timestamp DATETIME NOT NULL,
        species TEXT NOT NULL,
        probability INTEGER NOT NULL,
        conditions TEXT,
        factors TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS hotspots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        description TEXT,
        species_common TEXT,
        best_months TEXT,
        avg_success_rate REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert sample hotspots
    const hotspots = [
        ['Bay of Islands', -35.25, 174.1, 'Protected bay area, good for smaller pelagics and kingfish', 'Kingfish,Snapper,Trevally', '12,1,2,3', 65.5],
        ['North Cape', -34.42, 173.05, 'Current convergence zone - premier marlin fishing area', 'Blue Marlin,Striped Marlin,Yellowfin Tuna', '1,2,3,4,11,12', 78.2],
        ['King Bank', -34.15, 173.8, 'Underwater seamount - major tuna aggregation area', 'Yellowfin Tuna,Bigeye Tuna,Albacore', '11,12,1,2,3,4', 72.8],
        ['Middlesex Bank', -34.3, 173.6, 'Deep water bank - consistent big game fishing', 'Blue Marlin,Bigeye Tuna,Mako Shark', '12,1,2,3', 69.4],
        ['Three Kings Islands', -34.17, 172.13, 'Remote islands with pristine fishing', 'Marlin,Tuna,Kingfish,Hapuku', '1,2,3,4', 75.6]
    ];

    const stmt = db.prepare(`INSERT OR REPLACE INTO hotspots 
        (name, latitude, longitude, description, species_common, best_months, avg_success_rate) 
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
    
    hotspots.forEach(hotspot => {
        stmt.run(hotspot);
    });
    stmt.finalize();

    console.log('✅ Database setup complete');
});

db.close();
EOF

# Run database setup
node setup-db.js

# Create gitignore
cat > .gitignore << 'EOF'
node_modules/
.env
.env.local
.env.production
*.db
*.log
npm-debug.log*
.DS_Store
.vscode/
.idea/
data/
logs/
EOF

# Create start script
cat > start.sh << 'EOF'
#!/bin/bash
echo "🐟 Starting NZ Fishing Predictor..."
echo "🌐 Server will be available at: http://localhost:3000"
echo "📊 API endpoints at: http://localhost:3000/api"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""
npm start
EOF

chmod +x start.sh

# Create README
cat > README.md << 'EOF'
# 🐟 NZ Fishing Predictor

Real-time marlin and tuna fishing predictions for New Zealand waters from Bay of Islands to North Cape.

## Features

✅ **Real-time Environmental Data** - Sea temperature, currents, chlorophyll  
✅ **AI-Powered Predictions** - Fishing hotspots with probability scores  
✅ **Catch Logging** - Digital logbook with species, weight, gear tracking  
✅ **Interactive Maps** - Route planning and hotspot visualization  
✅ **Mobile Responsive** - Works on phones, tablets, and desktop  
✅ **User Accounts** - Personal catch history and preferences  

## Quick Start

1. **Install & Run:**
   ```bash
   ./start.sh
   ```

2. **Open Browser:**
   - Go to: http://localhost:3000
   - Create account or use as guest

3. **Start Fishing!**
   - View real-time conditions
   - Check fishing predictions
   - Log your catches
   - Plan fishing routes

## API Endpoints

- `GET /api/conditions/current` - Current environmental conditions
- `GET /api/predictions` - Fishing predictions by species
- `GET /api/catches/public` - Recent public catches
- `POST /api/catches` - Log a catch (requires login)
- `GET /api/hotspots` - Known fishing hotspots

## Deployment

### Railway (Recommended)
1. Push to GitHub
2. Connect Railway to repo
3. Deploy automatically

### Docker
```bash
docker build -t nz-fishing-predictor .
docker run -p 3000:3000 nz-fishing-predictor
```

### Manual
```bash
npm install
npm start
```

## Environment Variables

```env
PORT=3000
JWT_SECRET=your-secret-key
NOAA_API_KEY=your-api-key
OPENWEATHER_API_KEY=your-api-key
```

## Tech Stack

- **Backend:** Node.js, Express, SQLite
- **Frontend:** HTML5, JavaScript, Leaflet Maps
- **APIs:** NOAA, OpenWeather, Copernicus Marine
- **Deployment:** Railway, Vercel, Render, Docker

## License

MIT License - feel free to use for commercial fishing operations!
EOF

echo ""
echo "🎉 Setup Complete!"
echo ""
echo "📁 Project created in: $(pwd)"
echo ""
echo "🚀 To start the application:"
echo "   ./start.sh"
echo ""
echo "🌐 Then open: http://localhost:3000"
echo ""
echo "📝 Next steps:"
echo "   1. Get API keys from NOAA, OpenWeather"
echo "   2. Update .env file with your API keys"  
echo "   3. Deploy to Railway, Vercel, or Render"
echo ""
echo "🎣 Happy fishing!"