require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
// const twilio = require('twilio');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    "type": "service_account",
    "project_id": process.env.GOOGLE_PROJECT_ID,
    "private_key_id": process.env.GOOGLE_PRIVATE_KEY_ID,
    "private_key": process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    "client_email": process.env.GOOGLE_CLIENT_EMAIL,
    "client_id": process.env.GOOGLE_CLIENT_ID,
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": process.env.GOOGLE_CLIENT_CERT_URL
  })
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
// const twilioClient = twilio(
//     process.env.TWILIO_ACCOUNT_SID || 'your_account_sid',
//     process.env.TWILIO_AUTH_TOKEN || 'your_auth_token'
// );
// const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || 'your_twilio_number';

// Function to send SMS alerts using Firebase Cloud Functions
async function sendAlerts(stationId, newStatus) {
    // try {
    //     // Get all registered users
    //     const usersSnapshot = await db.collection('users').get();
        
    //     const message = `ALARMA Alert: Station ${stationId} is now reporting ${newStatus} status.`;
        
    //     // Send message to each registered user
    //     const promises = usersSnapshot.docs.map(async (doc) => {
    //         const userData = doc.data();
    //         const phoneNumber = userData.phoneNumber;
            
    //         try {
    //             const result = await twilioClient.messages.create({
    //                 body: message,
    //                 to: phoneNumber,
    //                 from: TWILIO_PHONE_NUMBER
    //             });
    //             console.log(`Message sent to ${phoneNumber}, SID: ${result.sid}`);
    //         } catch (error) {
    //             console.error(`Failed to send message to ${phoneNumber}:`, error);
    //         }
    //     });
        
    //     await Promise.all(promises);
    // } catch (error) {
    //     console.error('Error sending alerts:', error);
    // }
    try {
        // Get all registered users
        const usersSnapshot = await db.collection('users').get();

        const message = `ALARMA Alert: Station ${stationId} is now reporting ${newStatus} status.`;

        // Log messages instead of sending
        usersSnapshot.docs.forEach(doc => {
            const userData = doc.data();
            console.log(`Would send "${message}" to ${userData.phoneNumber}`);
        });

    } catch (error) {
        console.error('Error in sendAlerts:', error);
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
app.get('/get-station-status', async (req, res) => {
    const { s } = req.query;
    const stationId = `station-${parseInt(s) + 1}`;
    
    try {
        // Get status from Firestore
        const stationDoc = await db.collection('stations').doc(stationId).get();
        
        if (stationDoc.exists) {
            const stationData = stationDoc.data();
            res.json({ 
                success: true, 
                data: {
                    status: stationData.status,
                    lastUpdate: stationData.lastUpdate.toDate().toISOString()
                }
            });
        } else {
            // If no document exists, return normal status
            res.json({ 
                success: true, 
                data: {
                    status: 'normal',
                    lastUpdate: new Date().toISOString()
                }
            });
        }
    } catch (error) {
        console.error('Error getting station status:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving station status'
        });
    }
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

// Add a test endpoint
app.get('/test-sms', async (req, res) => {
    // try {
    //     await twilioClient.messages.create({
    //         body: 'This is a test message from ALARMA',
    //         to: 'your_verified_phone_number',  // Use your verified number for testing
    //         from: TWILIO_PHONE_NUMBER
    //     });
    //     res.json({ success: true, message: 'Test SMS sent successfully' });
    // } catch (error) {
    //     console.error('Error sending test SMS:', error);
    //     res.status(500).json({ success: false, error: error.message });
    // }
    res.json({
        success: true,
        message: 'SMS sending is currently disabled'
    });
});

// Start the server
const PORT = process.env.PORT || 5501;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
}); 