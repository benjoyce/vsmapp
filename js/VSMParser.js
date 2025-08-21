export default class VSMParser {
    constructor() {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
    }

    parse(dslText) {
        this.processes = {};
        this.flows = [];
        this.infoFlows = [];
        
        const lines = dslText.split('\n');
        let currentBlock = null;
        let currentBlockType = null;
        let currentBlockId = null;
        
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
            } else if (line === '}') {
                currentBlock = null;
                currentBlockType = null;
                currentBlockId = null;
            } else if (currentBlock) {
                const [key, ...valueParts] = line.split(':').map(part => part.trim());
                const value = valueParts.join(':').replace(/"/g, '').replace(/;$/, '');
                
                if (currentBlockType === 'process') {
                    currentBlock.attributes[key] = value;
                } else if (currentBlockType === 'flow') {
                    currentBlock[key] = value;
                }
            }
        }
        
        return {
            processes: this.processes,
            flows: this.flows,
            infoFlows: this.infoFlows
        };
    }
}