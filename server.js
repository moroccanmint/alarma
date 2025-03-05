require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const admin = require('firebase-admin');
const axios = require('axios');

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

// Add this before the API router definition
async function sendAlerts(stationId, newStatus) {
    console.log('Starting sendAlerts function for:', { stationId, newStatus });
    
    try {
        // Get all registered users
        const usersSnapshot = await db.collection('users').get();
        console.log(`Found ${usersSnapshot.size} users in database`);

        if (usersSnapshot.empty) {
            console.log('No registered users found');
            return;
        }

        // First, get all devices
        const devicesResponse = await axios({
            method: 'GET',
            url: 'https://api.pushbullet.com/v2/devices',
            headers: {
                'Access-Token': process.env.PUSHBULLET_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const devices = devicesResponse.data.devices;
        console.log('Available devices:', devices.map(d => ({
            iden: d.iden,
            nickname: d.nickname,
            has_sms: d.has_sms
        })));

        // Find SMS-capable device
        const smsDevice = devices.find(device => device.has_sms);
        if (!smsDevice) {
            throw new Error('No SMS-capable device found');
        }
        console.log('Found SMS-capable device:', {
            iden: smsDevice.iden,
            nickname: smsDevice.nickname,
            model: smsDevice.model
        });

        // Prepare message
        const message = `ALARMA Alert: Station ${stationId} is now reporting ${newStatus} status.`;

        // Filter users with phone numbers
        const usersWithPhones = usersSnapshot.docs.filter(doc => doc.data().phoneNumber);
        console.log(`Found ${usersWithPhones.length} users with phone numbers`);

        // Send SMS to each user
        for (const doc of usersWithPhones) {
            const userData = doc.data();
            try {
                console.log(`Attempting to send SMS to ${userData.phoneNumber}`);
                
                // Try using the SMS endpoint
                await axios({
                    method: 'POST',
                    url: 'https://api.pushbullet.com/v2/texts',
                    headers: {
                        'Access-Token': process.env.PUSHBULLET_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        data: {
                            target_device_iden: smsDevice.iden,
                            addresses: [userData.phoneNumber],
                            message: message
                        }
                    }
                });

                // Also send as a push notification as backup
                await axios({
                    method: 'POST',
                    url: 'https://api.pushbullet.com/v2/pushes',
                    headers: {
                        'Access-Token': process.env.PUSHBULLET_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    data: {
                        type: 'note',
                        title: `SMS to ${userData.phoneNumber}`,
                        body: message,
                        device_iden: smsDevice.iden,
                        source_device_iden: smsDevice.iden
                    }
                });

                console.log(`Successfully sent alert for ${userData.phoneNumber}`);
            } catch (smsError) {
                console.error(`Failed to send alert for ${userData.phoneNumber}:`, {
                    error: smsError.response?.data || smsError.message,
                    status: smsError.response?.status,
                    headers: smsError.response?.headers
                });
            }
        }

    } catch (error) {
        console.error('Error in sendAlerts:', {
            error: error.response?.data || error.message,
            stack: error.stack
        });
        throw error;
    }
}

// Create an API router
const apiRouter = express.Router();

// Move all API endpoints to the router
apiRouter.get('/update-station', async (req, res) => {
    const { s, st } = req.query;
    
    console.log('==== UPDATE STATION REQUEST STARTED ====');
    console.log('Raw parameters:', { s, st });
    
    if (s === undefined || st === undefined) {
        console.log('ERROR: Missing parameters');
        return res.status(400).json({ 
            success: false, 
            message: 'Missing required parameters' 
        });
    }
    
    const stationId = `station-${parseInt(s) + 1}`;
    const statusMap = ['normal', 'warning', 'emergency'];
    const status = statusMap[parseInt(st)];
    
    console.log('Parsed parameters:', { 
        stationId, 
        status, 
        originalStatus: st,
        statusIndex: parseInt(st)
    });
    
    try {
        // Update Firestore
        console.log('Attempting to update Firestore...');
        await db.collection('stations').doc(stationId).set({
            status: status,
            lastUpdate: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log('Firestore update successful');
        
        // Check status and send alerts
        console.log('Current status:', status);
        console.log('Should send alert:', status === 'warning' || status === 'emergency');
        
        if (status === 'warning' || status === 'emergency') {
            console.log(`ALERT CONDITION MET: Status is ${status}`);
            try {
                console.log('Calling sendAlerts function...');
                await sendAlerts(stationId, status);
                console.log('sendAlerts function completed successfully');
            } catch (alertError) {
                console.error('Alert sending failed:', alertError);
                console.error('Full error details:', {
                    message: alertError.message,
                    response: alertError.response?.data,
                    stack: alertError.stack
                });
            }
        } else {
            console.log('No alert needed - status is normal');
        }
        
        // Update local cache
        stationStatuses.set(stationId, {
            status: status,
            lastUpdate: new Date().toISOString()
        });
        
        console.log('==== UPDATE STATION REQUEST COMPLETED ====');
        
        res.json({ 
            success: true,
            data: {
                stationId,
                status,
                lastUpdate: new Date().toISOString(),
                alertSent: status === 'warning' || status === 'emergency'
            }
        });
    } catch (error) {
        console.error('==== UPDATE STATION REQUEST FAILED ====');
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        res.status(500).json({
            success: false,
            message: 'Error updating station status',
            error: error.message
        });
    }
});

apiRouter.get('/get-station-status', async (req, res) => {
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

apiRouter.get('/get-phone-numbers', async (req, res) => {
    try {
        // Get all users from the users collection
        const usersSnapshot = await db.collection('users').get();

        const phoneNumbers = [];
        usersSnapshot.forEach(doc => {
            const userData = doc.data();
            // Extract phone numbers from user data
            if (userData.phoneNumber) {
                phoneNumbers.push(userData.phoneNumber);
            }
        });

        res.json(phoneNumbers);
    } catch (error) {
        console.error('Error fetching phone numbers:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch phone numbers'
        });
    }
});

apiRouter.get('/test', (req, res) => {
    res.json({ status: 'Server is running' });
});

apiRouter.get('/test-sms', async (req, res) => {
    try {
        console.log('Testing SMS functionality');
        
        // Test the Pushbullet connection first
        const testResponse = await axios({
            method: 'GET',
            url: 'https://api.pushbullet.com/v2/users/me',
            headers: {
                'Access-Token': process.env.PUSHBULLET_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('Pushbullet connection successful:', testResponse.data.email);
        
        // Now test sending an alert
        await sendAlerts('test-station', 'test-alert');
        
        res.json({
            success: true,
            message: 'SMS test completed, check server logs for details'
        });
    } catch (error) {
        console.error('SMS test failed:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: 'SMS test failed',
            error: error.response?.data || error.message
        });
    }
});

// Add this new debug endpoint
apiRouter.get('/debug-status', (req, res) => {
    const { s, st } = req.query;
    const stationId = `station-${parseInt(s) + 1}`;
    const statusMap = ['normal', 'warning', 'emergency'];
    const status = statusMap[parseInt(st)];
    
    res.json({
        input: {
            s,
            st
        },
        parsed: {
            stationId,
            statusIndex: parseInt(st),
            status,
            wouldTriggerAlert: status === 'warning' || status === 'emergency'
        }
    });
});

// Add a debug endpoint to check Pushbullet setup
apiRouter.get('/debug-pushbullet', async (req, res) => {
    try {
        // Check Pushbullet API key
        console.log('Checking Pushbullet API key...');
        const userResponse = await axios({
            method: 'GET',
            url: 'https://api.pushbullet.com/v2/users/me',
            headers: {
                'Access-Token': process.env.PUSHBULLET_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        // Get devices
        const devicesResponse = await axios({
            method: 'GET',
            url: 'https://api.pushbullet.com/v2/devices',
            headers: {
                'Access-Token': process.env.PUSHBULLET_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        res.json({
            user: userResponse.data,
            devices: devicesResponse.data.devices.map(d => ({
                iden: d.iden,
                nickname: d.nickname,
                model: d.model,
                has_sms: d.has_sms
            }))
        });
    } catch (error) {
        res.status(500).json({
            error: error.response?.data || error.message
        });
    }
});

// Use the API router with a prefix
app.use('/api', apiRouter);

// Catch-all route for frontend
app.get('*', (req, res) => {
    // List of API endpoints that should not serve index.html
    const apiEndpoints = [
        '/update-station',
        '/get-station-status',
        '/get-phone-numbers',
        '/test',
        '/test-sms'
    ];
    
    // If the request is for an API endpoint, return 404
    if (apiEndpoints.includes(req.path)) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    
    // Otherwise serve index.html
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