require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const serviceAccount = require('./alarma-5c1e2-firebase-adminsdk-fbsvc-34be1ecec7.json');
const twilio = require('twilio');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

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

// Initialize Twilio client (add after other initializations)
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID || 'your_account_sid',
    process.env.TWILIO_AUTH_TOKEN || 'your_auth_token'
);
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || 'your_twilio_number';

// Function to send SMS alerts using Firebase Cloud Functions
async function sendAlerts(stationId, newStatus) {
    try {
        // Get all registered users
        const usersSnapshot = await db.collection('users').get();
        
        const message = `ALARMA Alert: Station ${stationId} is now reporting ${newStatus} status.`;
        
        // Send message to each registered user
        const promises = usersSnapshot.docs.map(async (doc) => {
            const userData = doc.data();
            const phoneNumber = userData.phoneNumber;
            
            try {
                const result = await twilioClient.messages.create({
                    body: message,
                    to: phoneNumber,
                    from: TWILIO_PHONE_NUMBER
                });
                console.log(`Message sent to ${phoneNumber}, SID: ${result.sid}`);
            } catch (error) {
                console.error(`Failed to send message to ${phoneNumber}:`, error);
            }
        });
        
        await Promise.all(promises);
    } catch (error) {
        console.error('Error sending alerts:', error);
    }
}

// Modified station update endpoint
app.get('/update-station', async (req, res) => {
    const { s, st } = req.query;
    
    if (s === undefined || st === undefined) {
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters' 
        });
    }
    
    const stationId = `station-${parseInt(s) + 1}`;
    const statusMap = ['normal', 'warning', 'emergency'];
    const status = statusMap[parseInt(st)];
    
    try {
        // Update Firestore
        await db.collection('stations').doc(stationId).set({
            status: status,
            lastUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // If status is warning or emergency, send alerts
        if (status !== 'normal') {
            await sendAlerts(stationId, status);
        }
        
        // Update local cache
        stationStatuses.set(stationId, {
            status: status,
            lastUpdate: new Date().toISOString()
        });
        
        res.json({ 
            success: true,
            data: stationStatuses.get(stationId)
        });
    } catch (error) {
        console.error('Error updating station:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating station status'
        });
    }
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

// Add this to your server.js
app.get('/test-sms', async (req, res) => {
    try {
        await twilioClient.messages.create({
            body: 'This is a test message from ALARMA',
            to: '+639497762961',  // Your verified number
            from: TWILIO_PHONE_NUMBER
        });
        res.json({ success: true, message: 'Test SMS sent successfully' });
    } catch (error) {
        console.error('Error sending test SMS:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
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