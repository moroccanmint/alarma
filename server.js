const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Enable CORS with more secure options
app.use(cors({
    origin: function(origin, callback) {
        const allowedOrigins = [
            'http://localhost:5501',
            'http://127.0.0.1:5501',
            'https://alarma.onrender.com'
        ];
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true // Allow credentials
}));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Store station statuses in memory
const stationStatuses = new Map();

// Endpoint to handle station updates
app.get('/update-station', (req, res) => {
    const { s, st } = req.query; // s for station number, st for status
    
    if (s === undefined || st === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters' 
        });
    }
    
    const stationId = `station-${parseInt(s) + 1}`;
    const statusMap = ['normal', 'warning', 'emergency'];
    const status = statusMap[parseInt(st)];
    
    // Update station status
    stationStatuses.set(stationId, {
        status: status,
        lastUpdate: new Date().toISOString()
    });
    
    console.log(`Station ${stationId} updated:`, stationStatuses.get(stationId));
    
    res.json({ 
        success: true,
        data: stationStatuses.get(stationId)
    });
});

// Get station status endpoint
app.get('/get-station-status', (req, res) => {
    const { s } = req.query;
    const stationId = `station-${parseInt(s) + 1}`;
    const status = stationStatuses.get(stationId);
    res.json({ 
        success: true, 
        data: status || null 
    });
});

// Add this to your server.js
app.get('/test', (req, res) => {
    res.json({ status: 'Server is running' });
});

// Catch-all route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Add error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// Start the server
const PORT = process.env.PORT || 5501;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 