import VSMParser from './VSMParser.js';
import VSMVisualizer from './VSMVisualizer.js';

let parser = new VSMParser();
let visualizer;

function initializeVSM() {
    visualizer = new VSMVisualizer(document.getElementById('vsmCanvas'));
    
    // Load saved state if it exists
    if (visualizer.loadState()) {
        parseAndVisualize();
    }
}

function parseAndVisualize() {
    const dslText = document.getElementById('dslEditor').value;
    
    try {
        const parsedData = parser.parse(dslText);
        visualizer.visualize(parsedData);
        
        // Remove any existing error messages
        const existingError = document.querySelector('.error');
        if (existingError) {
            existingError.remove();
        }
    } catch (error) {
        // Display error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error';
        errorDiv.textContent = `Parse Error: ${error.message}`;
        
        const canvasContainer = document.querySelector('.canvas-container');
        const existingError = document.querySelector('.error');
        if (existingError) {
            existingError.remove();
        }
        canvasContainer.insertBefore(errorDiv, document.getElementById('vsmCanvas'));
    }
}

// Save function
function saveVSM() {
    visualizer.saveState();
    // Show feedback to user
    const feedback = document.createElement('div');
    feedback.textContent = 'VSM saved successfully';
    feedback.style.position = 'fixed';
    feedback.style.top = '20px';
    feedback.style.right = '20px';
    feedback.style.background = '#2ecc71';
    feedback.style.color = 'white';
    feedback.style.padding = '10px 20px';
    feedback.style.borderRadius = '4px';
    feedback.style.opacity = '0';
    feedback.style.transition = 'opacity 0.3s';
    
    document.body.appendChild(feedback);
    setTimeout(() => feedback.style.opacity = '1', 10);
    setTimeout(() => {
        feedback.style.opacity = '0';
        setTimeout(() => document.body.removeChild(feedback), 300);
    }, 2000);
}

// Parse and visualize on page load
window.onload = initializeVSM;

// Auto-parse when typing (with debounce)
let parseTimeout;
document.getElementById('dslEditor').addEventListener('input', function() {
    clearTimeout(parseTimeout);
    parseTimeout = setTimeout(parseAndVisualize, 1000);
});

// Make functions available globally
window.saveVSM = saveVSM;
window.parseAndVisualize = parseAndVisualize;