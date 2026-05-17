// Firebase config — e-voting-dhanu1902
const firebaseConfig = {
  apiKey: "AIzaSyBxsgXKrchPrvEFpEe1NU0yz2VeCbs4h2c",
  authDomain: "e-voting-dhanu1902.firebaseapp.com",
  projectId: "e-voting-dhanu1902",
  storageBucket: "e-voting-dhanu1902.firebasestorage.app",
  messagingSenderId: "227466806324",
  appId: "1:227466806324:web:46f87d3444f330072db661",
  measurementId: "G-Y408Z4L9T1"
};

firebase.initializeApp(firebaseConfig);
const db      = firebase.firestore();
const storage = firebase.storage();
firebase.auth().signInAnonymously().catch(e => console.warn(e));
