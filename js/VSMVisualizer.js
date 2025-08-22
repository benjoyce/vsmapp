export default class VSMVisualizer {
    constructor(svgElement) {
        this.svg = svgElement;
        this.width = 900;
        this.height = 700;
        this.processWidth = 160;
        this.processHeight = 120;
        this.positions = {};
        this.currentFlows = [];
        this.currentInfoFlows = [];
        this.setupSVG();
    }

    setupSVG() {
        // Clear existing content
        while (this.svg.firstChild) {
            this.svg.removeChild(this.svg.firstChild);
        }

        // Define arrow marker
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
        marker.setAttribute('id', 'arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '9');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
        polygon.setAttribute('fill', '#2c3e50');
        
        marker.appendChild(polygon);
        defs.appendChild(marker);
        this.svg.appendChild(defs);
    }

    calculatePositions(processes, flows) {
        // Convert flows to adjacency list
        const graph = {};
        Object.keys(processes).forEach(id => {
            graph[id] = { in: [], out: [] };
        });
        
        flows.forEach(flow => {
            graph[flow.from].out.push(flow.to);
            graph[flow.to].in.push(flow.from);
        });

        // Find nodes with no incoming edges (start nodes)
        const startNodes = Object.keys(graph).filter(id => graph[id].in.length === 0);
        
        // Calculate x positions based on longest path from start
        const xPositions = {};
        const visited = new Set();
        
        const calculateXPosition = (nodeId, level = 0) => {
            if (!xPositions[level]) xPositions[level] = [];
            xPositions[level].push(nodeId);
            visited.add(nodeId);
            
            graph[nodeId].out.forEach(nextId => {
                if (!visited.has(nextId)) {
                    calculateXPosition(nextId, level + 1);
                }
            });
        };
        
        startNodes.forEach(startNode => calculateXPosition(startNode));
        
        // Calculate final positions
        const positions = {};
        const levels = Object.keys(xPositions).length;
        const xGap = (this.width - this.processWidth) / (levels || 1);
        
        Object.entries(xPositions).forEach(([level, nodes]) => {
            const yGap = (this.height - this.processHeight) / (nodes.length || 1);
            nodes.forEach((nodeId, index) => {
                positions[nodeId] = {
                    x: level * xGap + 50,
                    y: index * yGap + 50
                };
            });
        });
        
        return positions;
    }

    drawProcesses(processes, positions) {
        Object.keys(processes).forEach((processId, index) => {
            const process = processes[processId];
            const pos = positions[processId];
            
            const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            this.makeDraggable(group, processId);

            // Process box
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', pos.x);
            rect.setAttribute('y', pos.y);
            rect.setAttribute('width', this.processWidth);
            rect.setAttribute('height', this.processHeight);
            rect.setAttribute('class', `process-box${
                this.criticalPathData?.path.includes(processId) ? ' critical' : ''
            }`);
            rect.setAttribute('rx', '8');
            group.appendChild(rect);

            // Process name
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            title.setAttribute('x', pos.x + this.processWidth / 2);
            title.setAttribute('y', pos.y + 20);
            title.setAttribute('class', 'process-text');
            title.textContent = process.attributes.name || processId;
            group.appendChild(title);

            // Process attributes
            const attributes = [
                `CT: ${process.attributes.cycle_time || 'N/A'}`,
                `LT: ${process.attributes.lead_time || 'N/A'}`,
                `Batch: ${process.attributes.batch_size || 'N/A'}`,
                `Defect: ${process.attributes.defect_rate || 'N/A'}%`
            ];

            attributes.forEach((detail, i) => {
                const detailText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                detailText.setAttribute('x', pos.x + this.processWidth / 2);
                detailText.setAttribute('y', pos.y + 45 + i * 15);
                detailText.setAttribute('class', 'process-details');
                detailText.textContent = detail;
                group.appendChild(detailText);
            });

            // Owner text
            const owner = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            owner.setAttribute('x', pos.x + this.processWidth / 2);
            owner.setAttribute('y', pos.y + 110);
            owner.setAttribute('class', 'process-details');
            owner.setAttribute('font-style', 'italic');
            owner.textContent = process.attributes.owner || '';
            group.appendChild(owner);

            this.svg.appendChild(group);
        });
    }

    drawFlows(flows, positions) {
        flows.forEach(flow => {
            const startPos = positions[flow.from];
            const endPos = positions[flow.to];
            
            if (!startPos || !endPos) return;

            const { path, labelPosition } = this.calculateFlowPath(startPos, endPos);
            const flowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            flowLine.setAttribute('d', path);
            flowLine.setAttribute('class', `flow-line${
                this.criticalPathData?.flows.has(`${flow.from}-${flow.to}`) ? ' critical' : ''
            }`);
            this.svg.appendChild(flowLine);

            // Add wait time label
            if (flow.wait_time) {
                const waitLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                waitLabel.setAttribute('x', labelPosition.x);
                waitLabel.setAttribute('y', labelPosition.y);
                waitLabel.setAttribute('class', 'wait-time-label');
                waitLabel.setAttribute('text-anchor', 'middle');
                waitLabel.textContent = `Wait: ${flow.wait_time}`;
                this.makeWaitTimeEditable(waitLabel, flow);
                this.svg.appendChild(waitLabel);
            }
        });
    }

    calculateFlowPath(start, end) {
        const startX = start.x + this.processWidth;
        const startY = start.y + this.processHeight / 2;
        const endX = end.x;
        const endY = end.y + this.processHeight / 2;
        
        const midX = (startX + endX) / 2;
        
        // Calculate control points for the curve
        const c1x = midX;
        const c1y = startY;
        const c2x = midX;
        const c2y = endY;

        // Calculate position for the wait time label
        // Use Bezier curve formula to find point at t=0.5 (middle of the curve)
        const t = 0.5;
        const labelX = (1-t)**3 * startX + 
                      3*(1-t)**2 * t * c1x + 
                      3*(1-t) * t**2 * c2x + 
                      t**3 * endX;
        
        const labelY = (1-t)**3 * startY + 
                      3*(1-t)**2 * t * c1y + 
                      3*(1-t) * t**2 * c2y + 
                      t**3 * endY - 15; // Offset above the line

        return {
            path: `M ${startX} ${startY} 
                  C ${c1x} ${c1y}, 
                    ${c2x} ${c2y}, 
                    ${endX} ${endY}`,
            labelPosition: {
                x: labelX,
                y: labelY
            }
        };
    }

    makeDraggable(group, processId) {
        let selectedElement = null;
        let offset = { x: 0, y: 0 };
        
        group.style.cursor = 'move';
        
        const startDrag = (evt) => {
            selectedElement = group;
            const rect = group.querySelector('rect');
            
            // Get correct initial mouse position relative to SVG
            const svg = this.svg;
            const pt = svg.createSVGPoint();
            pt.x = evt.clientX;
            pt.y = evt.clientY;
            const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
            
            // Calculate offset using SVG coordinates
            offset.x = svgP.x - parseFloat(rect.getAttribute('x'));
            offset.y = svgP.y - parseFloat(rect.getAttribute('y'));
            
            window.addEventListener('mousemove', drag);
            window.addEventListener('mouseup', endDrag);
        };
        
        const drag = (evt) => {
            if (selectedElement) {
                evt.preventDefault();
                
                const svg = this.svg;
                const pt = svg.createSVGPoint();
                pt.x = evt.clientX;
                pt.y = evt.clientY;
                const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
                
                const newX = svgP.x - offset.x;
                const newY = svgP.y - offset.y;
                
                const rect = selectedElement.querySelector('rect');
                const oldX = parseFloat(rect.getAttribute('x'));
                const oldY = parseFloat(rect.getAttribute('y'));
                
                const deltaX = newX - oldX;
                const deltaY = newY - oldY;
                
                rect.setAttribute('x', newX);
                rect.setAttribute('y', newY);
                
                selectedElement.querySelectorAll('text').forEach(text => {
                    const currentX = parseFloat(text.getAttribute('x'));
                    const currentY = parseFloat(text.getAttribute('y'));
                    text.setAttribute('x', currentX + deltaX);
                    text.setAttribute('y', currentY + deltaY);
                });
                
                this.positions[processId] = { x: newX, y: newY };
                this.redrawFlows();
            }
        };
        
        const endDrag = () => {
            selectedElement = null;
            window.removeEventListener('mousemove', drag);
            window.removeEventListener('mouseup', endDrag);
        };
        
        group.addEventListener('mousedown', startDrag);
    }

    redrawFlows() {
        this.svg.querySelectorAll('.flow-line, .info-flow-line, .wait-time-label').forEach(el => el.remove());
        this.drawFlows(this.currentFlows, this.positions);
    }

    calculateCriticalPath(processes, flows) {
        const convertTime = (timeStr) => {
            if (!timeStr) return 0;
            const value = parseFloat(timeStr);
            return timeStr.endsWith('d') ? value : value / 86400;
        };

        // Build directed graph with times
        const graph = {};
        Object.keys(processes).forEach(id => {
            graph[id] = {
                edges: [],
                leadTime: convertTime(processes[id].attributes.lead_time)
            };
        });
        
        flows.forEach(flow => {
            graph[flow.from].edges.push({
                to: flow.to,
                waitTime: convertTime(flow.wait_time)
            });
        });

        // Find start nodes (no incoming edges)
        const startNodes = Object.keys(processes).filter(id => 
            !flows.some(f => f.to === id)
        );

        // Find all paths using iterative approach
        const findAllPaths = (start) => {
            const stack = [{
                node: start,
                path: [start],
                time: graph[start].leadTime
            }];
            const paths = [];

            while (stack.length > 0) {
                const { node, path, time } = stack.pop();

                // If this is an end node (no outgoing edges)
                if (graph[node].edges.length === 0) {
                    paths.push({ path, time });
                    continue;
                }

                // Add all possible next steps to stack
                for (const edge of graph[node].edges) {
                    stack.push({
                        node: edge.to,
                        path: [...path, edge.to],
                        time: time + edge.waitTime + graph[edge.to].leadTime
                    });
                }
            }

            return paths;
        };

        // Find the critical path
        let criticalPath = { path: [], time: 0 };
        
        startNodes.forEach(startNode => {
            const paths = findAllPaths(startNode);
            paths.forEach(path => {
                if (path.time > criticalPath.time) {
                    criticalPath = path;
                }
            });
        });

        // Create set of critical flow pairs
        const criticalFlowPairs = new Set();
        for (let i = 0; i < criticalPath.path.length - 1; i++) {
            criticalFlowPairs.add(`${criticalPath.path[i]}-${criticalPath.path[i + 1]}`);
        }

        return {
            path: criticalPath.path,
            time: criticalPath.time,
            flows: criticalFlowPairs
        };
    }

    visualize(data) {
        console.log('Visualizing data:', data);
        this.setupSVG();
        
        // Store current data for updates
        this.currentProcesses = data.processes;
        this.currentFlows = data.flows;
        this.currentInfoFlows = data.infoFlows;
        
        this.criticalPathData = this.calculateCriticalPath(data.processes, data.flows);
        console.log('Critical path:', this.criticalPathData);
        
        // Use saved positions if available, otherwise calculate new ones
        this.positions = this.savedPositions || this.calculatePositions(data.processes, data.flows);
        console.log('Positions:', this.positions);
        this.savedPositions = null; // Clear saved positions after using them
        
        // Draw the visualization
        this.drawProcesses(data.processes, this.positions);
        this.drawFlows(data.flows, this.positions);
        
        // Update totals
        const totalLeadTime = Object.values(data.processes)
            .reduce((sum, process) => sum + parseFloat(process.attributes.lead_time), 0);
        const totalWaitTime = data.flows
            .reduce((sum, flow) => sum + parseFloat(flow.wait_time), 0);
        const totalProcessTime = Object.values(data.processes)
            .reduce((sum, process) => sum + parseFloat(process.attributes.process_time), 0);

        document.getElementById('totalLeadTime').textContent = `${totalLeadTime.toFixed(1)}d`;
        document.getElementById('totalWaitTime').textContent = `${totalWaitTime.toFixed(1)}d`;
        document.getElementById('totalProcessTime').textContent = `${totalProcessTime.toFixed(1)}d`;
        document.getElementById('criticalPath').textContent = 
            `${this.criticalPathData.time.toFixed(1)}d (${this.criticalPathData.path.join(' → ')})`;
    }

    saveState() {
        const state = {
            dsl: document.getElementById('dslEditor').value,
            positions: this.positions
        };
        localStorage.setItem('vsmState', JSON.stringify(state));
    }

    loadState() {
        const savedState = localStorage.getItem('vsmState');
        if (savedState) {
            const state = JSON.parse(savedState);
            document.getElementById('dslEditor').value = state.dsl;
            this.savedPositions = state.positions;
            return true;
        }
        return false;
    }

    makeWaitTimeEditable(waitLabel, flow) {
        waitLabel.style.cursor = 'pointer';
        
        const startEdit = (evt) => {
            evt.stopPropagation();
            const input = document.createElement('input');
            input.type = 'text';
            input.value = flow.wait_time;
            input.style.position = 'absolute';
            input.style.left = `${evt.clientX - 40}px`;
            input.style.top = `${evt.clientY - 15}px`;
            input.style.width = '80px';
            input.style.height = '25px';
            input.style.fontSize = '12px';
            input.style.textAlign = 'center';
            input.style.border = '1px solid #2c3e50';
            input.style.borderRadius = '4px';
            
            const finishEdit = () => {
                const newValue = input.value;
                if (newValue && /^\d*\.?\d*d$/.test(newValue)) {
                    flow.wait_time = newValue;
                    waitLabel.textContent = `Wait: ${newValue}`;
                    
                    // Recalculate critical path and update visualization
                    this.criticalPathData = this.calculateCriticalPath(
                        this.currentProcesses, 
                        this.currentFlows
                    );
                    this.redrawFlows();
                    
                    // Update totals
                    const totalWaitTime = this.currentFlows
                        .reduce((sum, f) => sum + parseFloat(f.wait_time), 0);
                    document.getElementById('totalWaitTime').textContent = 
                        `${totalWaitTime.toFixed(1)}d`;
                    document.getElementById('criticalPath').textContent = 
                        `${this.criticalPathData.time.toFixed(1)}d (${this.criticalPathData.path.join(' → ')})`;
                }
                document.body.removeChild(input);
            };
            
            input.addEventListener('blur', finishEdit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') finishEdit();
                if (e.key === 'Escape') document.body.removeChild(input);
            });
            
            document.body.appendChild(input);
            input.focus();
            input.select();
        };
        
        waitLabel.addEventListener('click', startEdit);
    }
}