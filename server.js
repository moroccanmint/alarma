const express = require('express');
const cors = require('cors');
const app = express();

// Enable CORS with specific options
app.use(cors({
    origin: '*', // Be more specific in production
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

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

// Start the server
const PORT = 5501;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 