import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    initializeFirestore, 
    CACHE_SIZE_UNLIMITED,
    doc,
    onSnapshot,
    getDoc,
    setDoc,
    serverTimestamp,
    collection,
    query,
    getDocs,
    where,
    orderBy,
    limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase with persistence
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    experimentalForceOwningTab: false,
    synchronizeTabs: true
});

// Application state
let trackingInterval;
let currentDevice = null;
let isTracking = false;
let connectionUnsubscribe;

// Utility Functions
function showAlert(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '1000';
    alertDiv.style.minWidth = '300px';
    
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

function showLoading(show) {
    const loader = document.getElementById('loader') || createLoader();
    if (show) {
        document.body.appendChild(loader);
    } else {
        loader.remove();
    }
}

function createLoader() {
    const loader = document.createElement('div');
    loader.id = 'loader';
    loader.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 1000;
    `;
    loader.innerHTML = '<div class="spinner-border text-primary"></div>';
    return loader;
}

// Connection Management
function setupConnectionMonitor() {
    return onSnapshot(doc(db, ".info/connected"), (doc) => {
        const isOnline = doc.exists() ? doc.data()?.connected : false;
        updateConnectionUI(isOnline);
        
        if (isOnline) {
            checkQueuedLocations();
        }
    });
}

function updateConnectionUI(isOnline) {
    const statusElement = document.getElementById('connectionStatus') || 
                         document.createElement('div');
    statusElement.id = 'connectionStatus';
    statusElement.className = `alert alert-${isOnline ? 'success' : 'danger'} mb-3`;
    statusElement.textContent = isOnline ? 'Online' : 'Offline - Working in limited mode';
    
    const cardBody = document.querySelector('.card-body');
    if (cardBody && !document.getElementById('connectionStatus')) {
        cardBody.prepend(statusElement);
    }
}

async function checkQueuedLocations() {
    if (!currentDevice) return;
    
    const locations = await getDocs(query(
        collection(db, "locations"),
        where("deviceId", "==", currentDevice.id),
        where("status", "==", "queued")
    ));
    
    if (!locations.empty) {
        showAlert(`Syncing ${locations.size} queued locations`, 'success');
    }
}

// Device Management
async function verifyAccessCode() {
    const codeInput = document.getElementById('accessCode');
    const code = codeInput.value.trim().toUpperCase();
    
    if (!code || code.length !== 6) {
        showAlert("Please enter a valid 6-character access code", "warning");
        codeInput.focus();
        return;
    }

    if (isTracking) {
        stopTracking();
    }

    showLoading(true);
    
    try {
        // Check Firestore for access code
        const accessDoc = await getDoc(doc(db, "device_access", code));
        
        if (!accessDoc.exists()) {
            throw new Error("Invalid access code");
        }

        // Get device info
        const deviceDoc = await getDoc(doc(db, "devices", accessDoc.data().deviceId));
        
        if (!deviceDoc.exists()) {
            throw new Error("Device not found");
        }

        // Store device info
        currentDevice = {
            id: accessDoc.data().deviceId,
            name: deviceDoc.data().name || `Device ${code}`,
            accessCode: code
        };

        // Save to localStorage
        localStorage.setItem('currentDevice', JSON.stringify(currentDevice));
        
        // Update UI
        showDeviceSection();
        showAlert("Device verified successfully!", "success");

    } catch (error) {
        console.error("Verification failed:", error);
        showAlert(`Error: ${error.message}`, "danger");
        codeInput.select();
    } finally {
        showLoading(false);
    }
}

function showDeviceSection() {
    // Get references to elements
    const authSection = document.getElementById('authSection');
    const trackingSection = document.getElementById('trackingSection');
    const deviceNameElement = document.getElementById('deviceName');
    const deviceIdElement = document.getElementById('deviceId');
    
    // Null checks
    if (!authSection || !trackingSection || !deviceNameElement || !deviceIdElement) {
        console.error('Required DOM elements not found');
        showAlert('UI elements missing - please refresh the page', 'danger');
        return;
    }
    
    // Update UI
    authSection.classList.add('d-none');
    trackingSection.classList.remove('d-none');
    
    if (currentDevice) {
        deviceNameElement.textContent = currentDevice.name;
        deviceIdElement.textContent = currentDevice.id;
    }
}
function switchDevice() {
    if (isTracking) {
        stopTracking();
    }
    document.getElementById('authSection').classList.remove('d-none');
    document.getElementById('trackingSection').classList.add('d-none');
    document.getElementById('accessCode').value = '';
    document.getElementById('accessCode').focus();
}

// Tracking Functions
function startTracking() {
    const intervalInput = document.getElementById('interval');
    const interval = parseInt(intervalInput.value) * 1000;
    
    if (isNaN(interval) || interval < 5000) {
        intervalInput.value = 5;
        return;
    }

    updateLocation();
    trackingInterval = setInterval(updateLocation, Math.max(interval, 5000));
    
    document.getElementById('startTrackingBtn').classList.add('d-none');
    document.getElementById('stopTrackingBtn').classList.remove('d-none');
    document.getElementById('statusBadge').className = 'badge bg-success';
    document.getElementById('statusBadge').textContent = 'Tracking';
    isTracking = true;
}

async function updateLocation() {
    if (!currentDevice) return;

    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            });
        });

        const locationData = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: serverTimestamp(),
            deviceId: currentDevice.id,
            deviceName: currentDevice.name,
            status: navigator.onLine ? 'active' : 'queued'
        };

        await setDoc(doc(db, "locations", `${currentDevice.id}_${Date.now()}`), locationData);
        
        updateLocationUI(locationData);
        
        if (!navigator.onLine) {
            showAlert('Location saved offline. Will sync when connection resumes', 'info');
        }
    } catch (error) {
        console.error("Location error:", error);
        showAlert(`Location error: ${error.message}`, 'warning');
    }
}

function updateLocationUI(locationData) {
    document.getElementById('lastLocation').innerHTML = `
        <strong>Last Update:</strong> ${new Date().toLocaleTimeString()}<br>
        <strong>Lat:</strong> ${locationData.lat.toFixed(6)}<br>
        <strong>Lng:</strong> ${locationData.lng.toFixed(6)}<br>
        <strong>Accuracy:</strong> ${locationData.accuracy.toFixed(1)} meters
    `;
}

function stopTracking() {
    clearInterval(trackingInterval);
    document.getElementById('startTrackingBtn').classList.remove('d-none');
    document.getElementById('stopTrackingBtn').classList.add('d-none');
    document.getElementById('statusBadge').className = 'badge bg-secondary';
    document.getElementById('statusBadge').textContent = 'Offline';
    isTracking = false;
}

// Initialization
function setupEventListeners() {
    document.getElementById('verifyCodeBtn').addEventListener('click', verifyAccessCode);
    document.getElementById('startTrackingBtn').addEventListener('click', startTracking);
    document.getElementById('stopTrackingBtn').addEventListener('click', stopTracking);
    document.getElementById('switchDeviceBtn').addEventListener('click', switchDevice);
    
    document.getElementById('interval').addEventListener('change', (e) => {
        localStorage.setItem('trackingInterval', e.target.value);
    });
}

function loadSavedDevice() {
    try {
        const savedDevice = localStorage.getItem('currentDevice');
        const savedInterval = localStorage.getItem('trackingInterval');
        
        if (savedDevice) {
            currentDevice = JSON.parse(savedDevice);
            showDeviceSection();
        }
        
        if (savedInterval) {
            const intervalInput = document.getElementById('interval');
            if (intervalInput) {
                intervalInput.value = savedInterval;
            }
        }
    } catch (error) {
        console.error('Error loading saved device:', error);
    }
}
// Main initialization
(async function init() {
    try {
        connectionUnsubscribe = setupConnectionMonitor();
        setupEventListeners();
        loadSavedDevice();
    } catch (error) {
        console.error("Initialization failed:", error);
        showAlert("Application failed to initialize", "danger");
    }
})();

// Cleanup
window.addEventListener('beforeunload', () => {
    connectionUnsubscribe?.();
    clearInterval(trackingInterval);
});
// At the end of your device-client.js:
document.addEventListener('DOMContentLoaded', () => {
    (async function init() {
        try {
            connectionUnsubscribe = setupConnectionMonitor();
            setupEventListeners();
            loadSavedDevice();
        } catch (error) {
            console.error("Initialization failed:", error);
            showAlert("Application failed to initialize", "danger");
        }
    })();
});
