import VSMParser from './VSMParser.js';
import VSMVisualizer from './VSMVisualizer.js';

let parser = new VSMParser();
let visualizer = new VSMVisualizer(document.getElementById('vsmCanvas'));

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

// Parse and visualize on page load
window.onload = function() {
    parseAndVisualize();
};

// Auto-parse when typing (with debounce)
let parseTimeout;
document.getElementById('dslEditor').addEventListener('input', function() {
    clearTimeout(parseTimeout);
    parseTimeout = setTimeout(parseAndVisualize, 1000);
});

// Make parseAndVisualize available globally
window.parseAndVisualize = parseAndVisualize;