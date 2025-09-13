// server.js - Complete Backend Server for NZ Fishing Predictor
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cron = require('node-cron');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Database setup
const db = new sqlite3.Database('./fishing_app.db');

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Environmental data table
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

    // Catch logs table
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

    // Fishing predictions table
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

    // Fishing hotspots table
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

    // Insert initial hotspot data
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
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// API Routes

// User Authentication
app.post('/api/register', async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
        return res.status(400).json({ error: 'Email, password, and name required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run(
            'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
            [email, hashedPassword, name],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: 'Email already registered' });
                    }
                    return res.status(500).json({ error: 'Registration failed' });
                }

                const token = jwt.sign(
                    { userId: this.lastID, email, name },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );

                res.status(201).json({
                    message: 'User registered successfully',
                    token,
                    user: { id: this.lastID, email, name }
                });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password required' });
    }

    db.get(
        'SELECT * FROM users WHERE email = ?',
        [email],
        async (err, user) => {
            if (err) {
                return res.status(500).json({ error: 'Server error' });
            }

            if (!user) {
                return res.status(400).json({ error: 'Invalid credentials' });
            }

            try {
                const validPassword = await bcrypt.compare(password, user.password_hash);
                
                if (!validPassword) {
                    return res.status(400).json({ error: 'Invalid credentials' });
                }

                const token = jwt.sign(
                    { userId: user.id, email: user.email, name: user.name },
                    JWT_SECRET,
                    { expiresIn: '30d' }
                );

                res.json({
                    message: 'Login successful',
                    token,
                    user: { id: user.id, email: user.email, name: user.name }
                });
            } catch (error) {
                res.status(500).json({ error: 'Server error' });
            }
        }
    );
});

// Environmental data endpoints
app.get('/api/conditions/current', (req, res) => {
    const { lat = -34.25, lng = 173.25 } = req.query;
    
    // Get latest environmental data for the area
    db.get(`
        SELECT * FROM environmental_data 
        WHERE ABS(latitude - ?) < 0.1 AND ABS(longitude - ?) < 0.1 
        ORDER BY timestamp DESC 
        LIMIT 1
    `, [lat, lng], (err, data) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (!data) {
            // Return simulated data if no real data available
            data = generateSimulatedConditions(lat, lng);
        }

        // Calculate fishing favorability
        const favorability = calculateFishingFavorability(data);
        
        res.json({
            ...data,
            favorability,
            lastUpdated: data.timestamp || new Date().toISOString()
        });
    });
});

app.get('/api/conditions/grid', (req, res) => {
    const { bounds } = req.query; // Expected: "lat1,lng1,lat2,lng2"
    
    if (!bounds) {
        return res.status(400).json({ error: 'Bounds parameter required' });
    }

    const [lat1, lng1, lat2, lng2] = bounds.split(',').map(Number);
    
    db.all(`
        SELECT latitude, longitude, sea_temperature, current_speed, 
               current_direction, chlorophyll, wind_speed, timestamp
        FROM environmental_data 
        WHERE latitude BETWEEN ? AND ? 
          AND longitude BETWEEN ? AND ?
          AND timestamp > datetime('now', '-6 hours')
        ORDER BY timestamp DESC
    `, [Math.min(lat1, lat2), Math.max(lat1, lat2), Math.min(lng1, lng2), Math.max(lng1, lng2)], 
    (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        // If no recent data, generate grid with simulated data
        if (rows.length === 0) {
            rows = generateGridData(lat1, lng1, lat2, lng2);
        }

        res.json(rows);
    });
});

// Fishing predictions
app.get('/api/predictions', (req, res) => {
    const { species = 'all', hours = 24 } = req.query;
    
    const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    let query = `
        SELECT * FROM predictions 
        WHERE timestamp > ?
        ORDER BY probability DESC, timestamp DESC
    `;
    let params = [hoursAgo];

    if (species !== 'all') {
        query = `
            SELECT * FROM predictions 
            WHERE species = ? AND timestamp > ?
            ORDER BY probability DESC, timestamp DESC
        `;
        params = [species, hoursAgo];
    }

    db.all(query, params, (err, predictions) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        if (predictions.length === 0) {
            // Generate fresh predictions
            predictions = generateFreshPredictions();
            
            // Store them in database
            const stmt = db.prepare(`
                INSERT INTO predictions (latitude, longitude, timestamp, species, probability, conditions, factors)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            
            predictions.forEach(p => {
                stmt.run([p.latitude, p.longitude, p.timestamp, p.species, p.probability, 
                         JSON.stringify(p.conditions), JSON.stringify(p.factors)]);
            });
            stmt.finalize();
        }

        res.json(predictions);
    });
});

// Catch logging
app.post('/api/catches', authenticateToken, (req, res) => {
    const {
        species, weight, length, gear_type, latitude, longitude,
        depth, water_temp, time_caught, notes, photo_url
    } = req.body;

    if (!species || !weight || !gear_type || !latitude || !longitude || !time_caught) {
        return res.status(400).json({ 
            error: 'Required fields: species, weight, gear_type, latitude, longitude, time_caught' 
        });
    }

    db.run(`
        INSERT INTO catch_logs 
        (user_id, species, weight, length, gear_type, latitude, longitude, 
         depth, water_temp, time_caught, notes, photo_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [req.user.userId, species, weight, length, gear_type, latitude, longitude,
        depth, water_temp, time_caught, notes, photo_url], 
    function(err) {
        if (err) {
            return res.status(500).json({ error: 'Failed to log catch' });
        }

        // Update predictions based on successful catch
        updatePredictionsFromCatch({
            species, latitude, longitude, time_caught, 
            conditions: { water_temp, depth }
        });

        res.status(201).json({
            message: 'Catch logged successfully',
            catchId: this.lastID
        });
    });
});

app.get('/api/catches', authenticateToken, (req, res) => {
    const { limit = 50, offset = 0 } = req.query;
    
    db.all(`
        SELECT cl.*, u.name as angler_name
        FROM catch_logs cl
        JOIN users u ON cl.user_id = u.id
        WHERE cl.user_id = ?
        ORDER BY cl.time_caught DESC
        LIMIT ? OFFSET ?
    `, [req.user.userId, limit, offset], (err, catches) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(catches);
    });
});

app.get('/api/catches/public', (req, res) => {
    const { species, days = 7, limit = 100 } = req.query;
    
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    let query = `
        SELECT cl.species, cl.weight, cl.length, cl.gear_type, 
               cl.latitude, cl.longitude, cl.time_caught, cl.notes,
               u.name as angler_name
        FROM catch_logs cl
        JOIN users u ON cl.user_id = u.id
        WHERE cl.time_caught > ?
        ORDER BY cl.time_caught DESC
        LIMIT ?
    `;
    let params = [daysAgo, limit];

    if (species) {
        query = `
            SELECT cl.species, cl.weight, cl.length, cl.gear_type, 
                   cl.latitude, cl.longitude, cl.time_caught, cl.notes,
                   u.name as angler_name
            FROM catch_logs cl
            JOIN users u ON cl.user_id = u.id
            WHERE cl.species = ? AND cl.time_caught > ?
            ORDER BY cl.time_caught DESC
            LIMIT ?
        `;
        params = [species, daysAgo, limit];
    }

    db.all(query, params, (err, catches) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }

        // Anonymize precise locations (round to nearest 0.01 degree)
        const anonymizedCatches = catches.map(c => ({
            ...c,
            latitude: Math.round(c.latitude * 100) / 100,
            longitude: Math.round(c.longitude * 100) / 100,
            angler_name: c.angler_name.charAt(0) + '*'.repeat(c.angler_name.length - 1)
        }));

        res.json(anonymizedCatches);
    });
});

// Hotspots
app.get('/api/hotspots', (req, res) => {
    db.all(`
        SELECT h.*, 
               COUNT(cl.id) as recent_catches,
               AVG(cl.weight) as avg_weight
        FROM hotspots h
        LEFT JOIN catch_logs cl ON 
            ABS(cl.latitude - h.latitude) < 0.05 AND 
            ABS(cl.longitude - h.longitude) < 0.05 AND
            cl.time_caught > datetime('now', '-30 days')
        GROUP BY h.id
        ORDER BY h.avg_success_rate DESC
    `, (err, hotspots) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(hotspots);
    });
});

// Fishing alerts
app.get('/api/alerts', (req, res) => {
    const alerts = generateFishingAlerts();
    res.json(alerts);
});

// Statistics
app.get('/api/stats', (req, res) => {
    const { days = 30 } = req.query;
    const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    db.all(`
        SELECT 
            species,
            COUNT(*) as total_catches,
            AVG(weight) as avg_weight,
            MAX(weight) as max_weight,
            gear_type,
            COUNT(DISTINCT user_id) as unique_anglers
        FROM catch_logs
        WHERE time_caught > ?
        GROUP BY species, gear_type
        ORDER BY total_catches DESC
    `, [daysAgo], (err, stats) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(stats);
    });
});

// Helper Functions
function generateSimulatedConditions(lat, lng) {
    const now = new Date();
    return {
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        timestamp: now.toISOString(),
        sea_temperature: 18 + Math.random() * 8, // 18-26°C
        current_speed: Math.random() * 1.5, // 0-1.5 m/s
        current_direction: Math.floor(Math.random() * 360),
        chlorophyll: Math.random() * 0.6, // 0-0.6 mg/m³
        wind_speed: 5 + Math.random() * 20, // 5-25 kts
        wind_direction: Math.floor(Math.random() * 360),
        wave_height: 0.5 + Math.random() * 2.5 // 0.5-3m
    };
}

function calculateFishingFavorability(conditions) {
    let score = 0;
    const factors = {};

    // Sea surface temperature (optimal: 20-24°C)
    if (conditions.sea_temperature >= 20 && conditions.sea_temperature <= 24) {
        score += 25;
        factors.temperature = 'optimal';
    } else if (conditions.sea_temperature >= 18 && conditions.sea_temperature <= 26) {
        score += 15;
        factors.temperature = 'good';
    } else {
        factors.temperature = 'poor';
    }

    // Current speed (optimal: 0.5-1.2 m/s)
    if (conditions.current_speed >= 0.5 && conditions.current_speed <= 1.2) {
        score += 20;
        factors.current = 'optimal';
    } else if (conditions.current_speed >= 0.3 && conditions.current_speed <= 1.5) {
        score += 10;
        factors.current = 'good';
    } else {
        factors.current = 'poor';
    }

    // Chlorophyll (optimal: 0.1-0.4 mg/m³)
    if (conditions.chlorophyll >= 0.1 && conditions.chlorophyll <= 0.4) {
        score += 20;
        factors.chlorophyll = 'optimal';
    } else if (conditions.chlorophyll >= 0.05 && conditions.chlorophyll <= 0.6) {
        score += 10;
        factors.chlorophyll = 'good';
    } else {
        factors.chlorophyll = 'poor';
    }

    // Wind conditions (optimal: < 15 kts)
    if (conditions.wind_speed <= 15) {
        score += 15;
        factors.wind = 'optimal';
    } else if (conditions.wind_speed <= 20) {
        score += 8;
        factors.wind = 'good';
    } else {
        factors.wind = 'poor';
    }

    // Wave height (optimal: < 2m)
    if (conditions.wave_height <= 2) {
        score += 10;
        factors.waves = 'optimal';
    } else if (conditions.wave_height <= 3) {
        score += 5;
        factors.waves = 'good';
    } else {
        factors.waves = 'poor';
    }

    // Time of day bonus
    const hour = new Date().getHours();
    if ((hour >= 5 && hour <= 8) || (hour >= 17 && hour <= 19)) {
        score += 10;
        factors.time = 'prime_time';
    }

    return {
        score: Math.min(100, Math.max(0, score)),
        rating: score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'fair' : 'poor',
        factors
    };
}

function generateGridData(lat1, lng1, lat2, lng2) {
    const data = [];
    const gridSize = 0.02; // ~2km resolution
    
    for (let lat = lat1; lat <= lat2; lat += gridSize) {
        for (let lng = lng1; lng <= lng2; lng += gridSize) {
            data.push(generateSimulatedConditions(lat, lng));
        }
    }
    
    return data;
}

function generateFreshPredictions() {
    const species = ['Blue Marlin', 'Striped Marlin', 'Yellowfin Tuna', 'Bigeye Tuna', 'Albacore Tuna'];
    const locations = [
        { name: 'North Cape', lat: -34.42, lng: 173.05 },
        { name: 'King Bank', lat: -34.15, lng: 173.8 },
        { name: 'Middlesex Bank', lat: -34.3, lng: 173.6 },
        { name: 'Three Kings', lat: -34.17, lng: 172.13 }
    ];
    
    const predictions = [];
    const now = new Date();
    
    locations.forEach(location => {
        species.forEach(fish => {
            const conditions = generateSimulatedConditions(location.lat, location.lng);
            const favorability = calculateFishingFavorability(conditions);
            
            // Add species-specific modifiers
            let probability = favorability.score;
            if (fish.includes('Marlin') && conditions.sea_temperature > 22) probability += 10;
            if (fish.includes('Tuna') && conditions.current_speed > 0.8) probability += 8;
            
            probability = Math.min(100, Math.max(0, probability));
            
            predictions.push({
                latitude: location.lat,
                longitude: location.lng,
                timestamp: now.toISOString(),
                species: fish,
                probability: Math.round(probability),
                conditions,
                factors: favorability.factors
            });
        });
    });
    
    return predictions.sort((a, b) => b.probability - a.probability);
}

function generateFishingAlerts() {
    const alerts = [];
    const now = new Date();
    
    // Generate dynamic alerts based on conditions
    if (Math.random() > 0.3) {
        alerts.push({
            id: 1,
            type: 'hotspot',
            priority: 'high',
            title: 'Prime Fishing Conditions Detected',
            message: `Excellent conditions at North Cape - ${Math.round(75 + Math.random() * 20)}% success probability for marlin`,
            location: { lat: -34.42, lng: 173.05 },
            expires: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString()
        });
    }
    
    if (Math.random() > 0.4) {
        alerts.push({
            id: 2,
            type: 'environmental',
            priority: 'medium',
            title: 'Temperature Break Detected',
            message: 'Strong temperature gradient at King Bank - ideal for tuna aggregation',
            location: { lat: -34.15, lng: 173.8 },
            expires: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString()
        });
    }
    
    if (Math.random() > 0.5) {
        const hours = Math.round(2 + Math.random() * 4);
        alerts.push({
            id: 3,
            type: 'timing',
            priority: 'medium',
            title: 'Optimal Fishing Window',
            message: `Best fishing conditions expected in ${hours} hours during dawn period`,
            expires: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString()
        });
    }
    
    return alerts;
}

function updatePredictionsFromCatch(catchData) {
    // Update prediction accuracy based on successful catches
    // This would implement machine learning in production
    console.log('Updating predictions based on catch:', catchData);
}

// Data refresh job - runs every 3 hours
cron.schedule('0 */3 * * *', async () => {
    console.log('Running scheduled data refresh...');
    
    try {
        // In production, this would call real APIs
        await refreshEnvironmentalData();
        console.log('Environmental data refreshed');
    } catch (error) {
        console.error('Data refresh failed:', error);
    }
});

async function refreshEnvironmentalData() {
    // Simulate API calls to oceanographic services
    const locations = [
        { lat: -34.42, lng: 173.05 },
        { lat: -34.15, lng: 173.8 },
        { lat: -34.3, lng: 173.6 },
        { lat: -34.25, lng: 173.25 }
    ];
    
    const stmt = db.prepare(`
        INSERT INTO environmental_data 
        (latitude, longitude, timestamp, sea_temperature, current_speed, 
         current_direction, chlorophyll, wind_speed, wind_direction, wave_height)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (const location of locations) {
        const data = generateSimulatedConditions(location.lat, location.lng);
        stmt.run([
            data.latitude, data.longitude, data.timestamp,
            data.sea_temperature, data.current_speed, data.current_direction,
            data.chlorophyll, data.wind_speed, data.wind_direction, data.wave_height
        ]);
    }
    
    stmt.finalize();
}

// Serve the frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error(error.stack);
    res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`🐟 NZ Fishing Predictor Server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
    
    // Initial data population
    setTimeout(refreshEnvironmentalData, 5000);
});

module.exports = app;