import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, collection, doc, setDoc, onSnapshot,
    query, where, serverTimestamp, deleteDoc, getDocs,
    orderBy, limit, initializeFirestore, CACHE_SIZE_UNLIMITED
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Initialize Firebase with persistence
const app = initializeApp(firebaseConfig);
const db = initializeFirestore(app, {
    cacheSizeBytes: CACHE_SIZE_UNLIMITED
});
const auth = getAuth(app);

// Map and State Management
let map;
let deviceMarkers = {};
let devicePaths = {};
let unsubscribeFunctions = [];

function initMap() {
    map = L.map('map').setView([0, 0], 2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

// Device Management Functions
async function addDevice(deviceName) {
    if (!deviceName || deviceName.trim().length < 2) {
        throw new Error('Device name must be at least 2 characters');
    }

    const deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const deviceRef = doc(db, "devices", deviceId);
    
    try {
        await setDoc(deviceRef, {
            name: deviceName.trim(),
            createdAt: serverTimestamp(),
            owner: auth.currentUser.uid,
            status: 'inactive'
        });
        
        const accessCode = generateSecureCode();
        await setDoc(doc(db, "device_access", accessCode), {
            deviceId: deviceId,
            created: serverTimestamp(),
            owner: auth.currentUser.uid
        });
        
        return { deviceId, accessCode };
    } catch (error) {
        console.error("Error adding device:", error);
        throw error;
    }
}

async function removeDevice(deviceId) {
    if (!confirm('Are you sure you want to delete this device?')) return;
    
    try {
        // Delete device_access documents
        const accessQuery = query(
            collection(db, "device_access"),
            where("deviceId", "==", deviceId)
        );
        const accessSnapshot = await getDocs(accessQuery);
        const deletePromises = accessSnapshot.docs.map(doc => deleteDoc(doc.ref));
        
        // Delete device document
        deletePromises.push(deleteDoc(doc(db, "devices", deviceId)));
        
        // Delete location documents
        const locationQuery = query(
            collection(db, "locations"),
            where("deviceId", "==", deviceId)
        );
        const locationSnapshot = await getDocs(locationQuery);
        locationSnapshot.forEach(doc => {
            deletePromises.push(deleteDoc(doc.ref));
        });
        
        await Promise.all(deletePromises);
        
        // Clean up map elements
        if (deviceMarkers[deviceId]) {
            map.removeLayer(deviceMarkers[deviceId]);
            delete deviceMarkers[deviceId];
        }
        
        if (devicePaths[deviceId]) {
            map.removeLayer(devicePaths[deviceId]);
            delete devicePaths[deviceId];
        }
        
        showAlert('Device deleted successfully', 'success');
    } catch (error) {
        console.error("Error deleting device:", error);
        showAlert('Error deleting device', 'danger');
    }
}

// Location Tracking Functions
function setupDeviceListeners() {
    const q = query(
        collection(db, "locations"),
        where("owner", "==", auth.currentUser.uid),
        orderBy("timestamp", "desc")
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const data = change.doc.data();
            updateDeviceMarker(data.deviceId, data);
        });
    });
    
    unsubscribeFunctions.push(unsubscribe);
    return unsubscribe;
}

function updateDeviceMarker(deviceId, locationData) {
    const position = [locationData.lat, locationData.lng];
    
    // Create marker if it doesn't exist
    if (!deviceMarkers[deviceId]) {
        deviceMarkers[deviceId] = L.marker(position, {
            icon: L.divIcon({
                className: 'device-marker',
                html: `<div class="marker-pin"></div><span class="marker-label">${locationData.deviceName || 'Device'}</span>`,
                iconSize: [30, 42],
                iconAnchor: [15, 42]
            })
        }).addTo(map);
        
        devicePaths[deviceId] = L.polyline([position], {
            color: getRandomColor()
        }).addTo(map);
    }
    
    // Update existing marker
    deviceMarkers[deviceId]
        .setLatLng(position)
        .bindPopup(`
            <b>${locationData.deviceName || 'Device'}</b><br>
            ${new Date(locationData.timestamp?.toDate()).toLocaleString()}<br>
            Accuracy: ${locationData.accuracy?.toFixed(1)} meters
        `);
    
    // Update path
    const path = devicePaths[deviceId];
    path.addLatLng(position);
    
    // Center map if this is the first point
    if (path.getLatLngs().length === 1) {
        map.setView(position, 15);
    }
}

// View Device Functionality
window.centerOnDevice = async (deviceId) => {
    try {
        // Check if we already have a marker
        if (deviceMarkers[deviceId]) {
            map.setView(deviceMarkers[deviceId].getLatLng(), 15);
            return;
        }
        
        // Get latest location if no marker exists
        const locationQuery = query(
            collection(db, "locations"),
            where("deviceId", "==", deviceId),
            orderBy("timestamp", "desc"),
            limit(1)
        );
        
        const querySnapshot = await getDocs(locationQuery);
        
        if (!querySnapshot.empty) {
            const latestLocation = querySnapshot.docs[0].data();
            updateDeviceMarker(deviceId, latestLocation);
            map.setView([latestLocation.lat, latestLocation.lng], 15);
        } else {
            showAlert('No location data available for this device', 'warning');
        }
    } catch (error) {
        console.error("Error centering on device:", error);
        showAlert('Error loading device location', 'danger');
    }
};

// UI Rendering Functions
function renderDeviceList() {
    const deviceList = document.getElementById('deviceList');
    deviceList.innerHTML = '';
    
    const q = query(
        collection(db, "devices"),
        where("owner", "==", auth.currentUser.uid)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
        deviceList.innerHTML = '';
        
        if (snapshot.empty) {
            deviceList.innerHTML = '<div class="text-muted p-3">No devices found. Add your first device.</div>';
            return;
        }
        
        snapshot.forEach((doc) => {
            const device = doc.data();
            const item = document.createElement('div');
            item.className = 'list-group-item device-card';
            item.innerHTML = `
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${device.name}</strong>
                        <small class="d-block text-muted">${doc.id}</small>
                    </div>
                    <div>
                        <button class="btn btn-sm btn-outline-primary me-1" 
                                onclick="centerOnDevice('${doc.id}')">
                            View
                        </button>
                        <button class="btn btn-sm btn-outline-danger" 
                                onclick="removeDevice('${doc.id}')">
                            Delete
                        </button>
                    </div>
                </div>
            `;
            deviceList.appendChild(item);
        });
    });
    
    unsubscribeFunctions.push(unsubscribe);
    return unsubscribe;
}

// Utility Functions
function generateSecureCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function getRandomColor() {
    const colors = ['#FF6633', '#FFB399', '#FF33FF', '#FFFF99', '#00B3E6', 
                   '#E6B333', '#3366E6', '#999966', '#99FF99', '#B34D4D'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
    alertDiv.style.zIndex = '1000';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 5000);
}

// Initialization
onAuthStateChanged(auth, (user) => {
    if (user) {
        // UI Setup
        document.getElementById('authStatus').innerHTML = `
            <span class="navbar-text">Welcome, ${user.email}</span>
            <button class="btn btn-sm btn-outline-light ms-2" id="logoutBtn">Logout</button>
        `;
        
        document.getElementById('logoutBtn').addEventListener('click', () => {
            signOut(auth).catch(error => {
                console.error("Logout error:", error);
            });
        });
        
        // Initialize map and listeners
        initMap();
        setupDeviceListeners();
        renderDeviceList();
        
        // Add device button
        document.getElementById('addDeviceBtn').addEventListener('click', async () => {
            const deviceName = prompt("Enter device name:");
            if (!deviceName || deviceName.trim().length < 2) {
                alert('Device name must be at least 2 characters');
                return;
            }

            try {
                const { deviceId, accessCode } = await addDevice(deviceName);
                alert(`Device added successfully!\n\nDevice ID: ${deviceId}\nAccess Code: ${accessCode}\n\nShare this code with the device.`);
            } catch (error) {
                console.error("Error adding device:", error);
                alert('Error adding device: ' + error.message);
            }
        });
        
        // Cleanup on unload
        window.addEventListener('unload', () => {
            unsubscribeFunctions.forEach(fn => fn());
        });
    } else {
        window.location.href = "/login.html";
    }
});

// Global functions
window.removeDevice = removeDevice;
