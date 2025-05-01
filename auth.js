import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    signInWithEmailAndPassword(auth, email, password)
        .then(() => {
            window.location.href = '/index.html';
        })
        .catch(error => {
            alert('Login failed: ' + error.message);
        });
});

document.getElementById('registerLink').addEventListener('click', (e) => {
    e.preventDefault();
    const email = prompt("Enter email:");
    const password = prompt("Enter password:");
    
    if (email && password) {
        createUserWithEmailAndPassword(auth, email, password)
            .then(() => {
                alert('Account created successfully!');
                window.location.href = '/index.html';
            })
            .catch(error => {
                alert('Registration failed: ' + error.message);
            });
    }
});
