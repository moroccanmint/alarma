const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

// Enable CORS with more secure options
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://your-frontend-domain.onrender.com'] // Replace with your actual domain
        : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
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

// Start the server
const PORT = process.env.PORT || 5501;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 