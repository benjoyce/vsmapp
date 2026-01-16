export default class VSMParser {
    constructor() {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
        this.reworkFlows = [];
        this.positions = {};
    }

    parse(jsonText) {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
        this.reworkFlows = [];
        this.positions = {};
        
        try {
            const data = JSON.parse(jsonText);
            
            // Parse processes
            if (data.processes) {
                Object.entries(data.processes).forEach(([id, process]) => {
                    this.processes[id] = {
                        attributes: { ...process }
                    };
                    // Map lead_time to wait_time for internal consistency
                    if (this.processes[id].attributes.lead_time) {
                        this.processes[id].attributes.wait_time = this.processes[id].attributes.lead_time;
                        delete this.processes[id].attributes.lead_time;
                    }
                    // Remove cycle_time since it's calculated
                    delete this.processes[id].attributes.cycle_time;
                });
            }
            
            // Parse flows
            if (data.flows) {
                this.flows = data.flows.map(flow => ({
                    from: flow.from,
                    to: flow.to,
                    wait_time: flow.wait_time || '0d',
                    value_type: flow.value_type || 'NVA'
                }));
            }
            
            // Parse info flows
            if (data.infoFlows) {
                this.infoFlows = data.infoFlows;
            }
            
            // Parse rework flows
            if (data.reworkFlows) {
                this.reworkFlows = data.reworkFlows.map(rework => ({
                    from: rework.from,
                    to: rework.to,
                    rework_rate: rework.rework_rate || '0'
                }));
            }
            
            // Parse positions
            if (data.positions) {
                Object.entries(data.positions).forEach(([id, pos]) => {
                    this.positions[id] = { x: pos.x, y: pos.y };
                });
            }
        } catch (e) {
            console.error('Error parsing JSON:', e);
            // Return empty data on parse error
        }
        
        return {
            processes: this.processes,
            flows: this.flows,
            infoFlows: this.infoFlows,
            reworkFlows: this.reworkFlows,
            positions: this.positions
        };
    }

    serialize(data) {
        const output = {
            processes: {},
            flows: [],
            reworkFlows: [],
            positions: {}
        };
        
        // Serialize processes
        Object.entries(data.processes).forEach(([id, process]) => {
            const attrs = { ...process.attributes };
            // Map lead_time to wait_time when serializing
            if (attrs.lead_time) {
                attrs.wait_time = attrs.lead_time;
                delete attrs.lead_time;
            }
            // Remove calculated cycle_time
            delete attrs.cycle_time;
            output.processes[id] = attrs;
        });
        
        // Serialize flows
        if (data.flows) {
            output.flows = data.flows.map(flow => ({
                from: flow.from,
                to: flow.to,
                wait_time: flow.wait_time || '0d',
                value_type: flow.value_type || 'NVA'
            }));
        }
        
        // Serialize rework flows
        if (data.reworkFlows && data.reworkFlows.length > 0) {
            output.reworkFlows = data.reworkFlows.map(rework => ({
                from: rework.from,
                to: rework.to,
                rework_rate: rework.rework_rate || '0'
            }));
        }
        
        // Serialize positions
        if (data.positions && Object.keys(data.positions).length > 0) {
            Object.entries(data.positions).forEach(([id, pos]) => {
                output.positions[id] = {
                    x: Math.round(pos.x),
                    y: Math.round(pos.y)
                };
            });
        }
        
        return JSON.stringify(output, null, 2);
    }

    loadInitialDSL() {
        const editorElem = document.getElementById('dslEditor');
        const jsonText = editorElem.value;
        const parsedData = this.parse(jsonText);
        
        // If we have positions or rework flows in localStorage, merge them
        const savedVSM = localStorage.getItem('vsmState');
        if (savedVSM) {
            try {
                const savedData = JSON.parse(savedVSM);
                let needsUpdate = false;
                
                if (savedData.positions && Object.keys(savedData.positions).length > 0) {
                    parsedData.positions = savedData.positions;
                    needsUpdate = true;
                }
                
                if (savedData.reworkFlows && savedData.reworkFlows.length > 0) {
                    parsedData.reworkFlows = savedData.reworkFlows;
                    needsUpdate = true;
                }
                
                if (needsUpdate) {
                    // Update the editor with the merged data
                    editorElem.value = this.serialize(parsedData);
                }
            } catch (e) {
                console.error('Error loading saved data:', e);
            }
        }
        
        return parsedData;
    }
}
