export default class VSMParser {
    constructor() {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
        this.positions = {};
    }

    parse(dslText) {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
        this.positions = {};
        
        let currentBlock = null;
        let currentBlockType = null;
        let currentBlockId = null;
        
        const lines = dslText.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (!line) continue;
            
            if (line.startsWith('process ')) {
                const match = line.match(/process\s+(\w+)\s*{/);
                if (match) {
                    currentBlockType = 'process';
                    currentBlockId = match[1];
                    currentBlock = { attributes: {} };
                    this.processes[currentBlockId] = currentBlock;
                }
            } else if (line.startsWith('flow from ')) {
                const match = line.match(/flow from\s+(\w+)\s+to\s+(\w+)\s*{/);
                if (match) {
                    currentBlockType = 'flow';
                    currentBlock = { from: match[1], to: match[2] };
                    this.flows.push(currentBlock);
                }
            } else if (line === 'positions {') {
                currentBlockType = 'positions';
            } else if (line === '}') {
                currentBlockType = null;
                currentBlock = null;
            } else if (currentBlockType === 'positions') {
                const [id, coords] = line.trim().split(':').map(s => s.trim());
                if (coords) {
                    const [x, y] = coords.split(',').map(n => parseFloat(n));
                    if (!isNaN(x) && !isNaN(y)) {
                        this.positions[id] = { x, y };
                    }
                }
            } else if (currentBlock && currentBlockType === 'process') {
                const [key, ...valueParts] = line.split(':').map(part => part.trim());
                const value = valueParts.join(':').replace(/"/g, '');
                currentBlock.attributes[key] = value;
            } else if (currentBlock && currentBlockType === 'flow') {
                const [key, value] = line.split(':').map(part => part.trim());
                currentBlock[key] = value;
            }
        }
        
        return {
            processes: this.processes,
            flows: this.flows,
            infoFlows: this.infoFlows,
            positions: this.positions
        };
    }

    serialize(data) {
        let dsl = '';
        
        // Serialize processes
        Object.entries(data.processes).forEach(([id, process]) => {
            dsl += `process ${id} {\n`;
            Object.entries(process.attributes).forEach(([key, value]) => {
                dsl += `  ${key}: ${typeof value === 'string' ? `"${value}"` : value}\n`;
            });
            dsl += '}\n\n';
        });
        
        // Serialize flows
        data.flows.forEach(flow => {
            dsl += `flow from ${flow.from} to ${flow.to} {\n`;
            if (flow.wait_time) {
                dsl += `  wait_time: ${flow.wait_time}\n`;
            }
            dsl += '}\n\n';
        });
        
        // Serialize positions if they exist
        if (Object.keys(data.positions).length > 0) {
            dsl += 'positions {\n';
            Object.entries(data.positions).forEach(([id, pos]) => {
                dsl += `  ${id}: ${Math.round(pos.x)}, ${Math.round(pos.y)}\n`;
            });
            dsl += '}\n';
        }
        
        return dsl;
    }

    loadInitialDSL() {
        const editorElem = document.getElementById('dslEditor');
        const dslText = editorElem.value;
        const parsedData = this.parse(dslText);
        
        // If we have positions in localStorage, add them to the DSL
        const savedVSM = localStorage.getItem('vsmState');
        if (savedVSM) {
            try {
                const savedData = JSON.parse(savedVSM);
                if (savedData.positions && Object.keys(savedData.positions).length > 0) {
                    parsedData.positions = savedData.positions;
                    // Update the editor with the positions included
                    editorElem.value = this.serialize(parsedData);
                }
            } catch (e) {
                console.error('Error loading saved positions:', e);
            }
        }
        
        return parsedData;
    }
}