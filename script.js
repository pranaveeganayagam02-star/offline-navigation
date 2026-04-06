let map;
let userLat = 13.0827;
let userLon = 80.2707;

let routeLayer;
let userMarker;

let steps = [];
let currentStep = 0;
let navigationActive = false;
let zoomDone = false;

let recognition;
let isListening = false;

let cameraStream = null;

// 🔊 SPEAK
function speak(text) {
  speechSynthesis.cancel();
  let msg = new SpeechSynthesisUtterance(text);
  msg.lang = "en-IN";
  speechSynthesis.speak(msg);
}

// 🚀 START
window.onload = () => {

  map = L.map('map').setView([userLat, userLon], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  setTimeout(() => map.invalidateSize(), 500);

  startTracking();
};

// 📍 GPS TRACKING
function startTracking() {

  navigator.geolocation.watchPosition(
    (pos) => {

      userLat = pos.coords.latitude;
      userLon = pos.coords.longitude;

      let latlng = [userLat, userLon];

      if (!userMarker) {
        userMarker = L.marker(latlng).addTo(map);
      } else {
        userMarker.setLatLng(latlng);
      }

      if (navigationActive && !zoomDone) {
        map.setView(latlng, 17);
        zoomDone = true;
      }

      checkStepProgress();

    },
    (err) => console.log(err),
    { enableHighAccuracy: true }
  );
}

// 📏 DISTANCE
function getDistance(lat1, lon1, lat2, lon2) {
  let R = 6371000;
  let dLat = (lat2 - lat1) * Math.PI / 180;
  let dLon = (lon2 - lon1) * Math.PI / 180;

  let a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 🧭 STEP CHECK
function checkStepProgress() {

  if (!navigationActive || !steps.length) return;

  let step = steps[currentStep];
  let target = step.maneuver.location;

  let dist = getDistance(userLat, userLon, target[1], target[0]);

  if (dist < 25) {
    speak(step.maneuver.instruction);
    currentStep++;

    if (currentStep >= steps.length) {
      speak("You reached destination");
      stopNavigation();
    }
  }
}

// 🧠 WHERE TO GO
function whereToGo() {

  if (!navigationActive || !steps.length) {
    speak("No active navigation");
    return;
  }

  let step = steps[currentStep];
  speak(step.maneuver.instruction + " in " + Math.round(step.distance) + " meters");
}

// 🛑 STOP NAVIGATION
function stopNavigation() {

  navigationActive = false;
  steps = [];
  currentStep = 0;
  zoomDone = false;

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  speechSynthesis.cancel();
  speak("Navigation stopped");
}

// 📷 CAMERA
async function openCamera() {
  try {
    let video = document.getElementById("camera");

    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });

    video.srcObject = cameraStream;
    video.style.display = "block";

    setTimeout(() => map.invalidateSize(), 300);

    speak("Camera opened");

    startDetection();

  } catch {
    speak("Camera error");
  }
}

function closeCamera() {

  let video = document.getElementById("camera");

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  video.style.display = "none";

  stopDetection();

  setTimeout(() => map.invalidateSize(), 300);

  speak("Camera closed");
}

// 🤖 AI DETECTION
let model;
let detecting = false;
let lastSpoken = {};

async function loadModel() {
  model = await cocoSsd.load();
  console.log("AI loaded");
}

function canSpeak(label) {
  let now = Date.now();
  if (!lastSpoken[label] || now - lastSpoken[label] > 4000) {
    lastSpoken[label] = now;
    return true;
  }
  return false;
}

async function startDetection() {
  if (!model) await loadModel();
  detecting = true;
  detectFrame();
}

function stopDetection() {
  detecting = false;
}

async function detectFrame() {

  if (!detecting) return;

  let video = document.getElementById("camera");

  let predictions = await model.detect(video);

  predictions.forEach(p => {

    if (p.score > 0.6) {

      if (p.class === "person" && canSpeak("person")) {
        speak("Person ahead");
      }

      if ((p.class === "car" || p.class === "bus" || p.class === "truck") && canSpeak("vehicle")) {
        speak("Vehicle ahead");
      }

      if (p.class === "traffic light" && canSpeak("signal")) {
        speak("Traffic signal ahead");
      }
    }
  });

  setTimeout(detectFrame, 2000);
}

// 🎤 VOICE
function startListening() {

  if (isListening) return;

  recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();

  recognition.continuous = true;
  recognition.lang = "en-IN";

  recognition.start();
  isListening = true;

  recognition.onresult = (event) => {

    let speech = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();

    if (speech.includes("go to")) {
      findLocation(speech.replace("go to", "").trim());
    }

    if (speech.includes("stop navigation")) {
      stopNavigation();
    }

    if (speech.includes("where to go")) {
      whereToGo();
    }

    if (speech.includes("open camera")) {
      openCamera();
    }

    if (speech.includes("close camera")) {
      closeCamera();
    }
  };

  recognition.onend = () => restartListening();
}

function restartListening() {
  setTimeout(() => {
    try { recognition.start(); }
    catch { isListening = false; startListening(); }
  }, 1000);
}

// 🔍 LOCATION
async function findLocation(place) {

  let res = await fetch(`https://nominatim.openstreetmap.org/search?q=${place}&format=json`);
  let data = await res.json();

  if (!data.length) {
    speak("Location not found");
    return;
  }

  drawRoute(data[0].lat, data[0].lon);
}

// 🛣️ ROUTE
async function drawRoute(destLat, destLon) {

  let res = await fetch(`https://router.project-osrm.org/route/v1/driving/${userLon},${userLat};${destLon},${destLat}?overview=full&geometries=geojson&steps=true`);
  let data = await res.json();

  let route = data.routes[0].geometry;

  steps = data.routes[0].legs[0].steps;
  currentStep = 0;
  navigationActive = true;
  zoomDone = false;

  if (routeLayer) map.removeLayer(routeLayer);

  routeLayer = L.geoJSON(route).addTo(map);

  map.fitBounds(routeLayer.getBounds());

  speak("Navigation started");
}

// 🔥 START
document.body.addEventListener("click", () => {

  speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  speak("System ready");

  startListening();

}, { once: true });
