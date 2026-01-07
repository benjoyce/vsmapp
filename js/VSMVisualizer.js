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
        this.isPanning = false;
        this.selectedProcess = null;
        this.panStart = { x: 0, y: 0 };
        this.viewBox = { x: 0, y: 0, width: this.width, height: this.height };
        this.zoomLevel = 1;
        this.minZoom = 0.1;
        this.maxZoom = 3;

        // Layout offsets
        this.connectionPointOffset = 22; // legacy horizontal offset (kept for compatibility)
        // Vertical offset from the process center to position the connection point below the add-circle
        this.connectionPointVerticalOffset = 20; // px down from the process vertical center

        // Flow interaction state
        this.isDraggingFlow = false;
        this.flowDragStart = null;
        this.tempFlowLine = null;
        this.selectedFlow = null;

        this.setupSVG();
        this.setupPanning();
        this.setupZoom();
        this.setupFlowDeletion();
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
                this.criticalPathData?.flows && this.criticalPathData.flows.has(`${flow.from}-${flow.to}`) ? ' critical' : ''
            }`);

            // Add data attributes to identify the flow
            flowLine.setAttribute('data-flow-from', flow.from);
            flowLine.setAttribute('data-flow-to', flow.to);

            // Add click handler for flow selection
            flowLine.addEventListener('click', (evt) => {
                this.selectFlow(flow, flowLine, evt);
            });

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
        // Use context-stroke so the arrowhead inherits the stroke color of the path
        // (makes arrowheads match critical/normal flow colors)
        polygon.setAttribute('fill', 'context-stroke');
        polygon.setAttribute('stroke', 'none');

        marker.appendChild(polygon);
        defs.appendChild(marker);
        this.svg.appendChild(defs);

        // Add these lines after clearing the SVG
        this.svg.style.width = '100%';
        this.svg.style.height = '100%';
        this.svg.style.cursor = 'default';

        // Create a top-level controls layer so buttons and connection points
        // render above flow lines. This group will be appended after flows.
        const controlsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        controlsLayer.setAttribute('id', 'controls-layer');
        this.svg.appendChild(controlsLayer);
    }

    setupPanning() {
        // Prevent context menu on right-click
        this.svg.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Start panning on right mouse button down
        this.svg.addEventListener('mousedown', (e) => {
            if (e.button === 2) { // Right mouse button
                this.isPanning = true;
                this.panStart = {
                    x: e.clientX + this.viewBox.x,
                    y: e.clientY + this.viewBox.y
                };
                this.svg.style.cursor = 'grabbing';
            }
        });

        // Handle panning movement
        this.svg.addEventListener('mousemove', (e) => {
            if (this.isPanning) {
                const newX = this.panStart.x - e.clientX;
                const newY = this.panStart.y - e.clientY;

                // Update viewBox
                this.viewBox.x = newX;
                this.viewBox.y = newY;
                this.svg.setAttribute('viewBox',
                    `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
            }

            // Handle flow dragging
            this.dragFlow(e);
        });

        // Stop panning on mouse button release
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2 && this.isPanning) {
                this.isPanning = false;
                this.svg.style.cursor = 'default';
            }

            // Handle flow drag end
            this.endFlowDrag(e);
        });

        // Initialize viewBox
        this.svg.setAttribute('viewBox', 
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
    }

    setupZoom() {
        this.svg.addEventListener('wheel', (e) => {
            // Only handle zoom when Ctrl key is pressed
            if (e.ctrlKey) {
                e.preventDefault();
                
                // Get mouse position relative to SVG
                const svgPoint = this.svg.createSVGPoint();
                svgPoint.x = e.clientX;
                svgPoint.y = e.clientY;
                const mousePoint = svgPoint.matrixTransform(this.svg.getScreenCTM().inverse());

                // Calculate zoom factor based on wheel delta
                const delta = e.deltaY < 0 ? 1.1 : 0.9;
                const newZoom = Math.min(Math.max(this.zoomLevel * delta, this.minZoom), this.maxZoom);
                const zoomFactor = newZoom / this.zoomLevel;

                // Update viewBox to zoom around mouse position
                this.viewBox.width /= zoomFactor;
                this.viewBox.height /= zoomFactor;
                this.viewBox.x += (mousePoint.x - this.viewBox.x) * (1 - 1/zoomFactor);
                this.viewBox.y += (mousePoint.y - this.viewBox.y) * (1 - 1/zoomFactor);

                // Update zoom level and viewBox
                this.zoomLevel = newZoom;
                this.svg.setAttribute('viewBox', 
                    `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);
            }
        }, { passive: false });
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
            rect.setAttribute('data-process-id', processId);
            rect.setAttribute('class', `process-box${
                this.criticalPathData?.path.includes(processId) ? ' critical' : ''
            }`);
            rect.setAttribute('rx', '8');

            // Add data attribute to identify the process
            rect.setAttribute('data-process-id', processId);

            group.appendChild(rect);

            // Allow selecting a process by clicking its border
            rect.addEventListener('click', (evt) => {
                evt.stopPropagation();
                this.selectProcess(processId);
            });

            // Process name
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            title.setAttribute('x', pos.x + this.processWidth / 2);
            title.setAttribute('y', pos.y + 20);
            title.setAttribute('class', 'process-text editable');
            title.textContent = process.attributes.name || processId;
            title.style.cursor = 'pointer';

            // Make title editable
            this.makeNameEditable(title, processId);
            group.appendChild(title);

            // Process attributes
            const calculatedCT = this.calculateCycleTime(process);
            const defectRateValue = process.attributes.defect_rate || '0';
            const attributes = [
                { key: 'PT', value: process.attributes.process_time || 'N/A', attr: 'process_time' },
                { key: 'WT', value: process.attributes.wait_time || 'N/A', attr: 'wait_time' },
                { key: 'CT', value: calculatedCT, attr: 'cycle_time', calculated: true },
                { key: 'Rework Rate', value: `${defectRateValue}%`, attr: 'defect_rate' }
            ];

            attributes.forEach((attr, i) => {
                const detailText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                detailText.setAttribute('x', pos.x + this.processWidth / 2);
                detailText.setAttribute('y', pos.y + 45 + i * 15);
                detailText.setAttribute('class', 'process-details');
                detailText.textContent = `${attr.key}: ${attr.value}`;
                
                // Add data attribute for rework rate labels so we can identify and highlight them
                if (attr.attr === 'defect_rate') {
                    detailText.setAttribute('data-rework-rate', processId);
                }
                
                // Make time-based attributes editable (except calculated CT), and defect_rate
                if ((attr.attr.includes('time') && !attr.calculated) || attr.attr === 'defect_rate') {
                    this.makeAttributeEditable(detailText, processId, attr.attr, attr.key);
                    detailText.style.cursor = 'pointer';
                    detailText.setAttribute('class', 'process-details editable');
                }
                
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

            // Add plus symbol for adding new processes
            this.addPlusSymbol(group, processId, pos);

            // Add flow connection point (created by helper)
            this.addFlowConnectionPoint(group, processId, pos);
            // Append the process group to the SVG canvas
            this.svg.appendChild(group);
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
                    if (!isNaN(currentX)) {
                        text.setAttribute('x', currentX + deltaX);
                    }
                    if (!isNaN(currentY)) {
                        text.setAttribute('y', currentY + deltaY);
                    }
                });

                // Update the Add Process button (circle and plus symbol) which live in the controls layer
                const addProcessCircle = this.svg.querySelector(`.add-process-circle[data-add-for="${processId}"]`);
                const addProcessPlus = this.svg.querySelector(`.add-process-plus[data-add-for="${processId}"]`);

                if (addProcessCircle) {
                    // Recompute add-process center so it remains below the connection control
                    const connectionRadius = 12;
                    const connectionGap = 2;
                    const addRadius = 12;
                    const gapBetweenControls = 5;

                    const newCenterX = newX + this.processWidth;
                    // connection center y
                    const connCenterY = newY + this.processHeight / 2 - connectionRadius - connectionGap;
                    const newCenterY = connCenterY + connectionRadius + gapBetweenControls + addRadius;
                    addProcessCircle.setAttribute('cx', newCenterX);
                    addProcessCircle.setAttribute('cy', newCenterY);
                }

                if (addProcessPlus) {
                    const newCenterX = newX + this.processWidth;
                    // Keep text anchored to the circle center
                    const connectionRadius = 12;
                    const connectionGap = 2;
                    const addRadius = 12;
                    const gapBetweenControls = 5;
                    const connCenterY = newY + this.processHeight / 2 - connectionRadius - connectionGap;
                    const newCenterY = connCenterY + connectionRadius + gapBetweenControls + addRadius + 1;
                    addProcessPlus.setAttribute('x', newCenterX);
                    addProcessPlus.setAttribute('y', newCenterY);
                }
                
                // Update the flow connection point so it stays with the process
                const flowPoint = this.svg.querySelector(`.flow-connection-point[data-connection-for="${processId}"]`);
                if (flowPoint) {
                    const fpX = newX + this.processWidth;
                    // compute fpY so bottom of circle sits just above process midline
                    const fpCircleElem = flowPoint.querySelector('circle');
                    const connRadius = fpCircleElem ? parseFloat(fpCircleElem.getAttribute('r')) || 12 : 12;
                    const gap = 2;
                    const fpY = newY + this.processHeight / 2 - connRadius - gap;
                    const fpCircle = flowPoint.querySelector('circle');
                    const fpText = flowPoint.querySelector('text');
                    if (fpCircle) {
                        fpCircle.setAttribute('cx', fpX);
                        fpCircle.setAttribute('cy', fpY);
                    }
                    if (fpText) {
                        fpText.setAttribute('x', fpX);
                        fpText.setAttribute('y', fpY + 1);
                    }
                }
                this.positions[processId] = { x: newX, y: newY };
                this.redrawFlows();

                // Update the DSL editor with new positions
                this.updateDSLWithPositions();
            }
        };
        
        const endDrag = () => {
            selectedElement = null;
            window.removeEventListener('mousemove', drag);
            window.removeEventListener('mouseup', endDrag);
            this.saveState(); // Add this line
        };
        
        group.addEventListener('mousedown', startDrag);
    }

    // Add this new method to handle DSL updates
    updateDSLWithPositions() {
        const currentState = {
            processes: this.currentProcesses,
            flows: this.currentFlows,
            infoFlows: this.currentInfoFlows,
            positions: this.positions
        };

        // Get the current editor text and find the positions block
        let editorText = document.getElementById('dslEditor').value;
        const positionsStart = editorText.indexOf('positions {');
        
        if (positionsStart !== -1) {
            // Find the end of positions block
            const positionsEnd = editorText.indexOf('}', positionsStart) + 1;
            // Remove existing positions block
            editorText = editorText.substring(0, positionsStart) + 
                        editorText.substring(positionsEnd).trimStart();
        }

        // Format new positions block
        let positionsBlock = 'positions {\n';
        Object.entries(this.positions).forEach(([id, pos]) => {
            positionsBlock += `  ${id}: ${Math.round(pos.x)}, ${Math.round(pos.y)}\n`;
        });
        positionsBlock += '}\n';

        // Add positions block at the end of the DSL
        document.getElementById('dslEditor').value = 
            editorText.trim() + '\n\n' + positionsBlock;
    }

    redrawFlows() {
        // Save selected flow IDs if one is selected
        const selectedFlowIds = this.selectedFlow ? {
            from: this.selectedFlow.from,
            to: this.selectedFlow.to
        } : null;

        // Clear selection reference before removing elements
        if (this.selectedFlow) {
            this.selectedFlow = null;
        }

        // Remove all flow elements
        this.svg.querySelectorAll('.flow-line, .info-flow-line, .wait-time-label').forEach(el => el.remove());

        // Redraw all flows
        this.drawFlows(this.currentFlows, this.positions);

        // Make sure controls layer remains on top after flows are redrawn
        this.bringControlsToFront();

        // Restore selection if there was one
        if (selectedFlowIds) {
            const flowElement = this.svg.querySelector(
                `path[data-flow-from="${selectedFlowIds.from}"][data-flow-to="${selectedFlowIds.to}"]`
            );
            if (flowElement) {
                const flow = this.currentFlows.find(
                    f => f.from === selectedFlowIds.from && f.to === selectedFlowIds.to
                );
                if (flow) {
                    // Restore selection without triggering the click event
                    this.selectedFlow = {
                        from: flow.from,
                        to: flow.to,
                        element: flowElement
                    };
                    flowElement.classList.add('selected');
                }
            }
        }
    }

    calculateCriticalPath(processes, flows) {
        const convertTime = (timeStr) => {
            return this.convertTimeToStandardUnit(timeStr);
        };
        
        // Build directed graph with times
        const graph = {};
        Object.keys(processes).forEach(id => {
            const ptTime = convertTime(processes[id].attributes.process_time);
            const wtTime = convertTime(processes[id].attributes.wait_time);
            graph[id] = {
                edges: [],
                cycleTime: ptTime + wtTime,  // CT = PT + WT
                waitTime: wtTime
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
                time: graph[start].cycleTime  // CT already includes PT + WT
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
                        time: time + edge.waitTime + graph[edge.to].cycleTime  // CT already includes PT + WT
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

    saveState() {
        console.log('Saving VSM state...', new Date().toLocaleTimeString());

        const currentState = {
            processes: this.currentProcesses,
            flows: this.currentFlows,
            infoFlows: this.currentInfoFlows,
            positions: this.positions
        };

        // Update the DSL text with positions
        const dslText = window.parser.serialize(currentState);
        document.getElementById('dslEditor').value = dslText;

        // Save to localStorage as backup
        localStorage.setItem('vsmState', JSON.stringify(currentState));
    }

    visualize(data) {
        this.setupSVG();
        
        this.currentProcesses = data.processes;
        this.currentFlows = data.flows;
        this.currentInfoFlows = data.infoFlows;
        
        // Use existing positions or calculate new ones
        this.positions = data.positions && Object.keys(data.positions).length > 0 
            ? data.positions 
            : this.calculatePositions(data.processes, data.flows);
        
        this.criticalPathData = this.calculateCriticalPath(data.processes, data.flows);
        
        this.drawProcesses(data.processes, this.positions);
        this.drawFlows(data.flows, this.positions);

        // Ensure controls (add-buttons, connection dots) render above flows
        this.bringControlsToFront();
        
        // Update all timing calculations after loading state
        this.updateTimingCalculations();
        
        // Fit the canvas to show all processes
        this.fitCanvasToContent();
        
        // Highlight the highest rework rate
        this.highlightHighestReworkRate();

        // Ensure controls layer is moved to the end of the child list after render
        // Use a micro task to ensure any subsequent synchronous appends finish first.
        setTimeout(() => this.bringControlsToFront(), 0);
    }

    bringControlsToFront() {
        const controlsLayer = this.svg.querySelector('#controls-layer');
        if (controlsLayer) {
            // Re-append to move it to the end of the SVG children so it renders on top
            this.svg.appendChild(controlsLayer);
        }
    }

    fitCanvasToContent() {
        if (Object.keys(this.positions).length === 0) return;

        // Find the bounding box of all processes
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        Object.values(this.positions).forEach(pos => {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + this.processWidth);
            maxY = Math.max(maxY, pos.y + this.processHeight);
        });

        // Add padding around the content
        const padding = 50;
        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        // Calculate the width and height of the bounding box
        const boundingWidth = maxX - minX;
        const boundingHeight = maxY - minY;

        // Update viewBox to fit the content
        this.viewBox.x = minX;
        this.viewBox.y = minY;
        this.viewBox.width = boundingWidth;
        this.viewBox.height = boundingHeight;

        // Update the SVG viewBox
        this.svg.setAttribute('viewBox', 
            `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`);

        // Reset zoom level
        this.zoomLevel = 1;
    }

    loadState() {
        const savedState = localStorage.getItem('vsmState');
        if (savedState) {
            try {
                const state = JSON.parse(savedState);
                // Apply the saved state
                this.visualize(state);
                return true;
            } catch (e) {
                console.error('Error loading saved state:', e);
                return false;
            }
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
                if (newValue && /^\d*\.?\d+[Mwdhm]$/.test(newValue)) {
                    flow.wait_time = newValue;
                    waitLabel.textContent = `Wait: ${newValue}`;
                    
                    // Update all timing calculations
                    this.updateTimingCalculations();
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

    // Rename the makeCTEditable method to makePTEditable and update its contents:
    makePTEditable(ptText, processId) {  // Renamed from makeCTEditable
        ptText.style.cursor = 'pointer';
        let input = null;
        
        const startEdit = (evt) => {
            evt.stopPropagation();
            if (input) return;
            
            input = document.createElement('input');
            input.type = 'text';
            input.value = this.currentProcesses[processId].attributes.cycle_time || '';
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
                if (!input) return;
                
                const newValue = input.value;
                if (newValue && /^\d*\.?\d+[Mwdhm]$/.test(newValue)) {
                    this.currentProcesses[processId].attributes.cycle_time = newValue;
                    ptText.textContent = `PT: ${newValue}`;  // Changed from CT to PT
                    
                    this.updateDSLWithProcessAttribute(processId, 'cycle_time', newValue);
                    this.updateTimingCalculations();
                }
                
                if (input && input.parentNode) {
                    input.parentNode.removeChild(input);
                }
                input = null;
            };
            
            const handleKeyDown = (e) => {
                if (e.key === 'Enter') {
                    finishEdit();
                    e.preventDefault();
                }
                if (e.key === 'Escape') {
                    if (input && input.parentNode) {
                        input.parentNode.removeChild(input);
                    }
                    input = null;
                    e.preventDefault();
                }
            };
            
            input.addEventListener('blur', () => {
                // Use setTimeout to handle blur after potential click events
                setTimeout(finishEdit, 100);
            });
            input.addEventListener('keydown', handleKeyDown);
            
            document.body.appendChild(input);
            input.focus();
            input.select();
        };
        
        ptText.addEventListener('click', startEdit);
    }

    // Add this new method to update process attributes in DSL
    updateDSLWithProcessAttribute(processId, attributeName, value) {
        const editor = document.getElementById('dslEditor');
        const dslText = editor.value;
        const lines = dslText.split('\n');
        
        let inTargetProcess = false;
        let processStart = -1;
        let processEnd = -1;
        let attributeLine = -1;
        
        // Find the target process block and attribute
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line === `process ${processId} {`) {
                inTargetProcess = true;
                processStart = i;
                continue;
            }
            if (inTargetProcess) {
                if (line === '}') {
                    processEnd = i;
                    break;
                }
                if (line.startsWith(attributeName + ':')) {
                    attributeLine = i;
                }
            }
        }
        
        // Update the attribute value
        if (attributeLine !== -1) {
            lines[attributeLine] = `  ${attributeName}: ${value}`;
        } else if (processStart !== -1 && processEnd !== -1) {
            // Add new attribute if it doesn't exist
            lines.splice(processEnd, 0, `  ${attributeName}: ${value}`);
        }
        
        editor.value = lines.join('\n');
   }

    // Add helper function to calculate cycle time as PT + WT
    calculateCycleTime(process) {
        const ptTime = this.convertTimeToStandardUnit(process.attributes.process_time);
        const wtTime = this.convertTimeToStandardUnit(process.attributes.wait_time);
        const totalTime = ptTime + wtTime;
        
        // Convert back to appropriate display unit (preferring the larger unit, using 8-hour working days)
        if (totalTime >= 1) {
            return `${totalTime.toFixed(1)}d`;
        } else if (totalTime >= 1/8) {
            return `${(totalTime * 8).toFixed(1)}h`;
        } else if (totalTime >= 1/480) {
            return `${(totalTime * 480).toFixed(0)}m`;
        } else {
            return `${(totalTime * 28800).toFixed(0)}s`;
        }
    }

    // Add this new time conversion utility method to the VSMVisualizer class

    convertTimeToStandardUnit(timeStr) {
        if (!timeStr) return 0;
        const match = timeStr.match(/^(\d*\.?\d+)([Mwdhms])$/);
        if (!match) return 0;
        
        const value = parseFloat(match[1]);
        const unit = match[2];
        
        // Convert everything to days for internal calculations (using 8-hour working days)
        switch (unit) {
            case 'M': return value * 30;      // Months to days (30 working days)
            case 'w': return value * 5;       // Weeks to days (5 working days per week)
            case 'd': return value;           // Days (base unit - 8 working hours)
            case 'h': return value / 8;       // Hours to days (8 working hours per day)
            case 'm': return value / 480;     // Minutes to days (8 hours * 60 minutes = 480)
            case 's': return value / 28800;   // Seconds to days (8 hours * 3600 seconds = 28800)
            default: return 0;
        }
   }

    // Add this new method to handle all time-based updates
    updateCriticalPathStyling() {
        // Update all process boxes
        const processBoxes = this.svg.querySelectorAll('.process-box');
        processBoxes.forEach(box => {
            const processId = box.getAttribute('data-process-id');
            if (processId) {
                // Check if this process is on the critical path
                const isOnCriticalPath = this.criticalPathData?.path.includes(processId);

                // Update the class
                if (isOnCriticalPath) {
                    box.classList.add('critical');
                } else {
                    box.classList.remove('critical');
                }
            }
        });
    }

    updateTimingCalculations() {
        // Recalculate critical path
        this.criticalPathData = this.calculateCriticalPath(
            this.currentProcesses,
            this.currentFlows
        );
        
        // Get critical path flows set for filtering
        const criticalFlows = this.criticalPathData.flows || new Set();
        const criticalPath = this.criticalPathData.path || [];
        
        // Calculate total process time (sum of ONLY critical path process times)
        const totalProcessTime = criticalPath
            .reduce((sum, processId) => {
                const process = this.currentProcesses[processId];
                if (process) {
                    const ptTime = this.convertTimeToStandardUnit(process.attributes.process_time);
                    return sum + ptTime;
                }
                return sum;
            }, 0);

        // Calculate total process wait time (sum of ONLY critical path process wait times)
        const totalProcessWaitTime = criticalPath
            .reduce((sum, processId) => {
                const process = this.currentProcesses[processId];
                if (process) {
                    return sum + this.convertTimeToStandardUnit(process.attributes.wait_time);
                }
                return sum;
            }, 0);

        // Calculate total flow wait time (sum of ONLY critical path flow wait times)
        const totalFlowWaitTime = this.currentFlows
            .reduce((sum, flow) => {
                const flowKey = `${flow.from}-${flow.to}`;
                if (criticalFlows.has(flowKey)) {
                    return sum + this.convertTimeToStandardUnit(flow.wait_time);
                }
                return sum;
            }, 0);

        // Total Lead Time is the critical path time (longest path through the value stream)
        const totalLeadTime = this.criticalPathData.time || 0;

        // Create critical path display with process names
        const criticalPathNames = criticalPath.map(processId => {
            const process = this.currentProcesses[processId];
            return process ? (process.attributes.name || processId) : processId;
        });

        // Update the UI
        document.getElementById('totalLeadTime').textContent = `${totalLeadTime.toFixed(1)}d`;
        document.getElementById('totalWaitTime').textContent = `${(totalProcessWaitTime + totalFlowWaitTime).toFixed(1)}d`;
        document.getElementById('totalProcessTime').textContent = `${totalProcessTime.toFixed(1)}d`;
        document.getElementById('criticalPath').textContent =
            `${totalLeadTime.toFixed(1)}d (${criticalPathNames.join(' → ')})`;

        // Update critical path styling
        this.updateCriticalPathStyling();

        // Redraw flows to update critical path highlighting
        this.redrawFlows();
    }

    // Add this new method to parse DSL changes
    parseDSLChanges() {
        const dslText = document.getElementById('dslEditor').value;
        const parsedData = window.parser.parse(dslText);
        
        // No time validation needed since CT is calculated as PT + WT
        
        // Update current data if validation passes
        this.currentProcesses = parsedData.processes;
        this.currentFlows = parsedData.flows;
        
        // Update all timing calculations
        this.updateTimingCalculations();
    }

    // Add these new methods to the VSMVisualizer class

    addPlusSymbol(group, processId, pos) {
        // Compute positions so the add-circle sits directly under the
        // flow connection circle with a 5px gap between them.
        const connectionRadius = 12;
        const connectionGap = 2; // same gap used in addFlowConnectionPoint
        const addRadius = 12;
        const gapBetweenControls = 5; // requested 5px gap between controls

        const addCx = pos.x + this.processWidth;
        // connection center = midY - connectionRadius - connectionGap
        const connCenterY = pos.y + this.processHeight / 2 - connectionRadius - connectionGap;
        // add center sits below the connection circle: connCenterY + connectionRadius + gapBetweenControls + addRadius
        const addCy = connCenterY + connectionRadius + gapBetweenControls + addRadius;

        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', addCx);
        circle.setAttribute('cy', addCy);
        circle.setAttribute('r', String(addRadius));
        circle.setAttribute('fill', 'white');
        circle.setAttribute('stroke', '#2c3e50');
        circle.setAttribute('stroke-width', '2');
        circle.setAttribute('class', 'add-process-circle');
        // Make add-process circle visible by default
        circle.style.opacity = '0.95';
        circle.style.cursor = 'pointer';
        circle.style.transition = 'opacity 0.15s';

        const plus = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        plus.setAttribute('x', addCx);
        plus.setAttribute('y', addCy + 1);
        plus.setAttribute('text-anchor', 'middle');
        plus.setAttribute('dominant-baseline', 'middle');
        plus.setAttribute('font-size', '20');
        plus.setAttribute('font-weight', 'bold');
        plus.setAttribute('class', 'add-process-plus');
        // Make add-process plus visible by default
        plus.style.opacity = '0.95';
        plus.style.cursor = 'pointer';
        plus.style.transition = 'opacity 0.15s';
        plus.textContent = '+';

        // Keep the add button visible at all times; hover handlers left for smoother transition
        group.addEventListener('mouseenter', () => {
            circle.style.opacity = '1';
            plus.style.opacity = '1';
        });

        group.addEventListener('mouseleave', () => {
            circle.style.opacity = '0.95';
            plus.style.opacity = '0.95';
        });

        const addNewProcess = () => {
            const newId = this.generateNewProcessId(processId);
            const newProcess = this.createNewProcess(processId, newId);
            
            // Add the new process to the current processes
            this.currentProcesses[newId] = newProcess;
            
            // Add a flow from the current process to the new one
            const newFlow = {
                from: processId,
                to: newId,
                wait_time: '0.5d'
            };
            this.currentFlows.push(newFlow);
            
            // Calculate position for the new process, avoiding overlaps
            const newPosition = this.findNonOverlappingPosition(pos.x, pos.y);
            this.positions[newId] = newPosition;
            
            // Update the DSL
            this.updateDSLWithNewProcess(newProcess, newId, newFlow);
            
            // Redraw the visualization
            this.visualize({
                processes: this.currentProcesses,
                flows: this.currentFlows,
                infoFlows: this.currentInfoFlows,
                positions: this.positions
            });
            this.saveState(); // Add this line
        };

        circle.addEventListener('click', addNewProcess);
        circle.addEventListener('click', addNewProcess);
        plus.addEventListener('click', addNewProcess);

        // Tag these so they can be found when they're moved to the controls layer
        circle.setAttribute('data-add-for', processId);
        plus.setAttribute('data-add-for', processId);

        // Append UI controls to the controls layer (top of SVG) so they render above flows
        const controlsLayer = this.svg.querySelector('#controls-layer') || this.svg;
        controlsLayer.appendChild(circle);
        controlsLayer.appendChild(plus);
    }

    /**
     * Find a non-overlapping position for a new process box.
     * First tries directly to the right, then alternates above/below if occupied.
     */
    findNonOverlappingPosition(sourceX, sourceY) {
        const horizontalGap = 100;
        const verticalGap = 50;
        const newX = sourceX + this.processWidth + horizontalGap;
        
        // Helper to check if a position overlaps with any existing process
        const overlapsExisting = (x, y) => {
            for (const id in this.positions) {
                const existingPos = this.positions[id];
                // Check for bounding box overlap with some margin
                const overlapX = x < existingPos.x + this.processWidth && 
                                 x + this.processWidth > existingPos.x;
                const overlapY = y < existingPos.y + this.processHeight && 
                                 y + this.processHeight > existingPos.y;
                if (overlapX && overlapY) {
                    return true;
                }
            }
            return false;
        };
        
        // First try: directly to the right at the same Y level
        if (!overlapsExisting(newX, sourceY)) {
            return { x: newX, y: sourceY };
        }
        
        // Alternate above and below with increasing distance
        const verticalStep = this.processHeight + verticalGap;
        for (let offset = 1; offset <= 10; offset++) {
            // Try above
            const yAbove = sourceY - offset * verticalStep;
            if (yAbove >= 0 && !overlapsExisting(newX, yAbove)) {
                return { x: newX, y: yAbove };
            }
            
            // Try below
            const yBelow = sourceY + offset * verticalStep;
            if (!overlapsExisting(newX, yBelow)) {
                return { x: newX, y: yBelow };
            }
        }
        
        // Fallback: just place it to the right (original behavior)
        return { x: newX, y: sourceY };
    }

    createNewProcess(baseId, newId) {
        const baseProcess = this.currentProcesses[baseId];
        return {
            attributes: {
                stage_id: parseInt(baseProcess.attributes.stage_id || 1) + 1,
                name: `New ${baseProcess.attributes.name || baseId}`,
                owner: baseProcess.attributes.owner || '',
                description: `New process derived from ${baseId}`,
                wait_time: '0d',
                process_time: '0s',
                defect_rate: '0'
            }
        };
    }

    updateDSLWithNewProcess(process, processId, flow) {
        const editor = document.getElementById('dslEditor');
        let dslText = editor.value;
        
        // Add new process
        const processBlock = `\nprocess ${processId} {
  stage_id: ${process.attributes.stage_id}
  name: "${process.attributes.name}"
  owner: "${process.attributes.owner}"
  description: "${process.attributes.description}"
  wait_time: ${process.attributes.wait_time}
  process_time: ${process.attributes.process_time}
  defect_rate: ${process.attributes.defect_rate}
}\n`;

    // Add new flow
    const flowBlock = `\nflow from ${flow.from} to ${flow.to} {
  wait_time: ${flow.wait_time}
}\n`;

    // Insert before positions block if it exists
    const positionsIndex = dslText.indexOf('positions {');
    if (positionsIndex !== -1) {
        dslText = dslText.slice(0, positionsIndex) + processBlock + flowBlock + dslText.slice(positionsIndex);
    } else {
        dslText += processBlock + flowBlock;
    }

    editor.value = dslText;
}

showCustomAlert(message, onClose) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'custom-alert-message';
    messageDiv.textContent = message;
    
    const button = document.createElement('button');
    button.className = 'custom-alert-button';
    button.textContent = 'OK';
    button.onclick = () => {
        document.body.removeChild(alertDiv);
        if (onClose) onClose();
    };
    
    alertDiv.appendChild(messageDiv);
    alertDiv.appendChild(button);
    document.body.appendChild(alertDiv);
    
    // Focus the button
    button.focus();
}

// Flow interaction methods
setupFlowDeletion() {
    document.addEventListener('keydown', (evt) => {
            if (evt.key === 'Delete') {
                if (this.selectedProcess) {
                    this.deleteSelectedProcess();
                } else if (this.selectedFlow) {
                    this.deleteSelectedFlow();
                }
            }
    });

    // Deselect flow when clicking on canvas background
    this.svg.addEventListener('click', (evt) => {
            if (evt.target === this.svg || evt.target.tagName === 'svg') {
                this.deselectFlow();
                this.deselectProcess();
            }
    });
}

selectFlow(flow, element, evt) {
    evt.stopPropagation();

    // Deselect previous flow
    this.deselectFlow();

    // Select this flow
    this.selectedFlow = {
        from: flow.from,
        to: flow.to,
        element: element
    };
    element.classList.add('selected');
}

deselectFlow() {
    if (this.selectedFlow && this.selectedFlow.element) {
        this.selectedFlow.element.classList.remove('selected');
    }
    this.selectedFlow = null;
}

    // Process selection helpers
    selectProcess(processId) {
        // Deselect any existing process
        this.deselectProcess();

        const rect = this.svg.querySelector(`rect[data-process-id="${processId}"]`);
        if (rect) {
            rect.classList.add('selected-process');
            this.selectedProcess = processId;
        }
    }

    deselectProcess() {
        if (!this.selectedProcess) return;
        const prev = this.svg.querySelector(`rect[data-process-id="${this.selectedProcess}"]`);
        if (prev) prev.classList.remove('selected-process');
        this.selectedProcess = null;
    }

    deleteSelectedProcess() {
        if (!this.selectedProcess) return;
        const id = this.selectedProcess;

        // Remove process
        if (this.currentProcesses && this.currentProcesses[id]) {
            delete this.currentProcesses[id];
        }

        // Remove any flows that reference this process
        this.currentFlows = this.currentFlows.filter(f => f.from !== id && f.to !== id);
        this.currentInfoFlows = this.currentInfoFlows.filter(f => f.from !== id && f.to !== id);

        // Remove position entry
        if (this.positions && this.positions[id]) delete this.positions[id];

        // Clear selection
        this.selectedProcess = null;

        // Re-render and persist state
        this.visualize({
            processes: this.currentProcesses,
            flows: this.currentFlows,
            infoFlows: this.currentInfoFlows,
            positions: this.positions
        });
        this.saveState();
    }
    
deleteSelectedFlow() {
    if (!this.selectedFlow) return;

    const {from, to} = this.selectedFlow;

    // Remove from currentFlows
    const flowIndex = this.currentFlows.findIndex(f => f.from === from && f.to === to);
    if (flowIndex !== -1) {
        this.currentFlows.splice(flowIndex, 1);
    }

    // Update DSL
    this.updateDSLRemoveFlow(from, to);

    // Deselect
    this.deselectFlow();

    // Redraw
    this.redrawFlows();

    // Update calculations
    this.updateTimingCalculations();

    // Save state
    this.saveState();
}

updateDSLRemoveFlow(fromId, toId) {
    const editor = document.getElementById('dslEditor');
    if (!editor) return;

    let dslText = editor.value;

    // Find and remove the flow block
    const flowPattern = new RegExp(
        `\\n*flow\\s+from\\s+${fromId}\\s+to\\s+${toId}\\s*\\{[^}]*\\}\\n*`,
        'g'
    );

    dslText = dslText.replace(flowPattern, '\n');

    editor.value = dslText;
}

addFlowConnectionPoint(group, processId, pos) {
    const connectionRadius = 12;
    // Position the connection point so the bottom of the circle sits just above
    // the vertical middle of the process box. That means centerY = midY - r - gap.
    const gap = 2; // px spacing between circle bottom and process midline
    const x = pos.x + this.processWidth;
    const y = pos.y + this.processHeight / 2 - connectionRadius - gap;

    // Create a group for the connection control so it can contain a circle + symbol
    const connGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    connGroup.setAttribute('class', 'flow-connection-point');
    connGroup.setAttribute('data-connection-for', processId);

    // Circle (styled like the add-process button)
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', connectionRadius);
    circle.setAttribute('fill', 'white');
    circle.setAttribute('stroke', '#2c3e50');
    circle.setAttribute('stroke-width', '2');
    circle.style.opacity = '0.95';

    // Infinity symbol instead of plus
    const inf = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    inf.setAttribute('x', x);
    inf.setAttribute('y', y + 1);
    inf.setAttribute('text-anchor', 'middle');
    inf.setAttribute('dominant-baseline', 'middle');
    inf.setAttribute('font-size', '18');
    inf.setAttribute('class', 'flow-connection-symbol');
    inf.style.cursor = 'pointer';
    inf.style.fill = '#2c3e50';
    inf.textContent = '∞';

    connGroup.appendChild(circle);
    connGroup.appendChild(inf);

    // Make everything interactive
    connGroup.style.pointerEvents = 'auto';
    connGroup.style.cursor = 'pointer';

    // Start flow drag when clicking the control
    connGroup.addEventListener('mousedown', (evt) => {
        evt.stopPropagation();
        this.startFlowDrag(evt, processId);
    });

    // Append the connection point group to the controls layer so it sits above flows
    const controlsLayer = this.svg.querySelector('#controls-layer') || this.svg;
    controlsLayer.appendChild(connGroup);
}

    // Helper to generate a new unique process id based on a base id.
    generateNewProcessId(baseId) {
        if (!this.currentProcesses) return `${baseId}_1`;
        let i = 1;
        let candidate = `${baseId}_${i}`;
        while (this.currentProcesses[candidate]) {
            i += 1;
            candidate = `${baseId}_${i}`;
            // Safety cap to avoid infinite loops
            if (i > 10000) break;
        }
        return candidate;
    }

startFlowDrag(evt, fromProcessId) {
    this.isDraggingFlow = true;

    // Prefer the actual connection point coordinates if available
    let startX = null, startY = null;
    if (evt && evt.target) {
        // Try to find the closest flow-connection-point group (works if text or circle was clicked)
        let el = null;
        try { el = evt.target.closest('.flow-connection-point'); } catch (e) { el = null; }
        if (el && el.classList && el.classList.contains('flow-connection-point')) {
            const c = el.querySelector('circle');
            if (c) {
                const cx = parseFloat(c.getAttribute('cx'));
                const cy = parseFloat(c.getAttribute('cy'));
                if (!isNaN(cx) && !isNaN(cy)) {
                    startX = cx;
                    startY = cy;
                }
            }
        }
    }

    if (startX === null || startY === null) {
        const pt = this.svg.createSVGPoint();
        pt.x = evt.clientX;
        pt.y = evt.clientY;
        const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());
        startX = svgP.x;
        startY = svgP.y;
    }

    this.flowDragStart = {
        processId: fromProcessId,
        x: startX,
        y: startY
    };

    // Create temporary line
    this.tempFlowLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempFlowLine.setAttribute('class', 'temp-flow-line');
    this.svg.appendChild(this.tempFlowLine);

    // Prevent default dragging behavior
    evt.preventDefault();
}

    dragFlow(evt) {
        if (!this.isDraggingFlow || !this.tempFlowLine) return;

        const pt = this.svg.createSVGPoint();
        pt.x = evt.clientX;
        pt.y = evt.clientY;
        const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());

        // Draw line from start to current position
        const path = `M ${this.flowDragStart.x} ${this.flowDragStart.y} L ${svgP.x} ${svgP.y}`;
        this.tempFlowLine.setAttribute('d', path);

        // Check if over a valid target
        const targetProcess = this.getProcessAtPoint(svgP.x, svgP.y);
        if (targetProcess && this.canCreateFlow(this.flowDragStart.processId, targetProcess)) {
            this.tempFlowLine.classList.add('valid');
            this.tempFlowLine.classList.remove('invalid');
        } else {
            this.tempFlowLine.classList.add('invalid');
            this.tempFlowLine.classList.remove('valid');
        }
    }

endFlowDrag(evt) {
    if (!this.isDraggingFlow) return;

    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());

    // Check if over a valid target
    const targetProcess = this.getProcessAtPoint(svgP.x, svgP.y);
    if (targetProcess && this.canCreateFlow(this.flowDragStart.processId, targetProcess)) {
        this.createFlow(this.flowDragStart.processId, targetProcess);
    }

    // Cleanup
    if (this.tempFlowLine) {
        this.svg.removeChild(this.tempFlowLine);
        this.tempFlowLine = null;
    }
    this.isDraggingFlow = false;
    this.flowDragStart = null;
}

getProcessAtPoint(x, y) {
    // Prefer DOM-based hit testing (reads rect attributes) to avoid stale coord issues
    const rects = this.svg.querySelectorAll('rect[data-process-id]');
    for (const rect of rects) {
        const pid = rect.getAttribute('data-process-id');
        const rx = parseFloat(rect.getAttribute('x'));
        const ry = parseFloat(rect.getAttribute('y'));
        const rw = parseFloat(rect.getAttribute('width'));
        const rh = parseFloat(rect.getAttribute('height'));
        if (!isNaN(rx) && !isNaN(ry) && !isNaN(rw) && !isNaN(rh)) {
            if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) {
                return pid;
            }
        }
    }
    return null;
}

canCreateFlow(fromId, toId) {
    // No self-loops
    if (fromId === toId) return false;

    // No duplicate flows
    const exists = this.currentFlows.some(f => f.from === fromId && f.to === toId);
    return !exists;
}

createFlow(fromId, toId) {
    const newFlow = {
        from: fromId,
        to: toId,
        wait_time: '0d'
    };

    // Add to currentFlows
    this.currentFlows.push(newFlow);

    // Update DSL
    this.updateDSLWithNewFlow(newFlow);

    // Redraw
    this.redrawFlows();

    // Update calculations
    this.updateTimingCalculations();

    // Save state
    this.saveState();
}

updateDSLWithNewFlow(flow) {
    const editor = document.getElementById('dslEditor');
    if (!editor) return;

    let dslText = editor.value;

    const flowBlock = `\nflow from ${flow.from} to ${flow.to} {
  wait_time: ${flow.wait_time}
}\n`;

    // Find the positions block if it exists
    const positionsIndex = dslText.indexOf('positions {');

    if (positionsIndex !== -1) {
        // Insert before positions block
        dslText = dslText.substring(0, positionsIndex) + flowBlock + dslText.substring(positionsIndex);
    } else {
        // Append to end
        dslText += flowBlock;
    }

    editor.value = dslText;
}

redrawFlows() {
    // Save selected flow IDs if one is selected
    const selectedFlowIds = this.selectedFlow ? {
        from: this.selectedFlow.from,
        to: this.selectedFlow.to
    } : null;

    // Clear selection reference before removing elements
    if (this.selectedFlow) {
        this.selectedFlow = null;
    }

    // Remove all flow elements
    this.svg.querySelectorAll('.flow-line, .info-flow-line, .wait-time-label').forEach(el => el.remove());

    // Redraw all flows
    this.drawFlows(this.currentFlows, this.positions);

    // Restore selection if there was one
    if (selectedFlowIds) {
        const flowElement = this.svg.querySelector(
            `path[data-flow-from="${selectedFlowIds.from}"][data-flow-to="${selectedFlowIds.to}"]`
        );
        if (flowElement) {
            const flow = this.currentFlows.find(
                f => f.from === selectedFlowIds.from && f.to === selectedFlowIds.to
            );
            if (flow) {
                this.selectedFlow = {
                    from: flow.from,
                    to: flow.to,
                    element: flowElement
                };
                flowElement.classList.add('selected');
            }
        }
    }

    // Make sure controls layer remains on top after flows are redrawn
    this.bringControlsToFront();

    // Also schedule a microtask to re-assert top layering in case other
    // synchronous code appends elements after this method runs.
    setTimeout(() => this.bringControlsToFront(), 0);
}

makeAttributeEditable(textElement, processId, attributeName, displayPrefix) {
    textElement.style.cursor = 'pointer';
    let input = null;
    let isEditing = false;
    let isShowingAlert = false;
    
    const startEdit = (evt) => {
        evt.stopPropagation();
        if (isEditing) return;
        isEditing = true;
        
        input = document.createElement('input');
        input.type = 'text';
        
        // For defect_rate, show just the number (strip % if present)
        let initialValue = this.currentProcesses[processId].attributes[attributeName] || '';
        if (attributeName === 'defect_rate') {
            initialValue = initialValue.toString().replace('%', '').trim();
            if (!initialValue) initialValue = '0';
        }
        input.value = initialValue;
        input.style.position = 'absolute';
        input.style.left = `${evt.clientX - 40}px`;
        input.style.top = `${evt.clientY - 15}px`;
        input.style.width = '80px';
        input.style.height = '25px';
        input.style.fontSize = '12px';
        input.style.textAlign = 'center';
        input.style.border = '1px solid #2c3e50';
        input.style.borderRadius = '4px';

        const validateValue = (value) => {
            if (!value && value !== '0') return false;
            
            // Special validation for defect_rate (Rework Rate)
            if (attributeName === 'defect_rate') {
                // Strip % if present
                const numValue = parseFloat(value.toString().replace('%', '').trim());
                if (isNaN(numValue)) return false;
                if (numValue < 0 || numValue > 100) {
                    if (!isShowingAlert) {
                        isShowingAlert = true;
                        this.showCustomAlert('Rework Rate must be between 0 and 100', () => {
                            isShowingAlert = false;
                        });
                    }
                    return false;
                }
                return true;
            }
            
            const isValid = attributeName.includes('time') ? 
                /^\d*\.?\d+[Mwdhms]$/.test(value) :
                /^\d*\.?\d+$/.test(value);
            
            if (!isValid) return false;

            // Time validation - only basic format validation needed since CT is calculated
            if (attributeName.includes('time')) {
                // No hierarchy validation needed since CT = PT + WT automatically
                // Wait time and process time are independent and can be any positive value
            }
            
            return true;
        };

        const saveValue = () => {
            if (isShowingAlert) return false;
            let newValue = input.value.trim();
            
            // For defect_rate, strip % and validate range
            if (attributeName === 'defect_rate') {
                newValue = newValue.toString().replace('%', '').trim();
                if (!newValue) newValue = '0';
            }
            
            if (validateValue(newValue)) {
                // For defect_rate, store just the number (not the %)
                const valueToStore = attributeName === 'defect_rate' ? newValue : newValue;
                
                // Update the process attribute
                this.currentProcesses[processId].attributes[attributeName] = valueToStore;
                
                // Display with % for defect_rate
                const displayValue = attributeName === 'defect_rate' ? `${valueToStore}%` : valueToStore;
                textElement.textContent = `${displayPrefix}: ${displayValue}`;
                
                // Update DSL and recalculate everything
                this.updateDSLWithProcessAttribute(processId, attributeName, valueToStore);
                this.updateTimingCalculations();

                // Redraw the visualization (this will also highlight the highest rework rate)
                this.visualize({
                    processes: this.currentProcesses,
                    flows: this.currentFlows,
                    infoFlows: this.currentInfoFlows,
                    positions: this.positions
                });
                
                return true;
            }
            
            return false;
        };

        const cleanup = () => {
            if (!isShowingAlert && input && input.parentNode) {
                input.removeEventListener('keydown', handleKeyDown);
                input.removeEventListener('blur', handleBlur);
                document.body.removeChild(input);
                isEditing = false;
                input = null;
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (saveValue()) {
                    cleanup();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };

        const handleBlur = () => {
            if (!isShowingAlert) {
                setTimeout(() => {
                    if (saveValue()) {
                        cleanup();
                    }
                }, 100);
            }
        };

        input.addEventListener('keydown', handleKeyDown);
        input.addEventListener('blur', handleBlur);
        
        document.body.appendChild(input);
        input.focus();
        input.select();
    };
    
    textElement.addEventListener('click', startEdit);
}

    /**
     * Highlight the process with the highest rework rate by making its label red
     */
    highlightHighestReworkRate() {
        const processes = this.currentProcesses || {};
        
        if (Object.keys(processes).length === 0) return;
        
        // Find the process with the highest rework rate
        let highestRate = -1;
        let highestProcessId = null;
        const ties = [];
        
        Object.entries(processes).forEach(([processId, process]) => {
            const rate = parseFloat(process.attributes.defect_rate || '0');
            if (!isNaN(rate)) {
                if (rate > highestRate) {
                    highestRate = rate;
                    highestProcessId = processId;
                    ties.length = 0;
                    ties.push(processId);
                } else if (rate === highestRate && rate > 0) {
                    ties.push(processId);
                }
            }
        });
        
        // Clear previous red styling from all rework rate labels
        const allReworkLabels = this.svg.querySelectorAll('[data-rework-rate]');
        allReworkLabels.forEach(label => {
            label.style.fill = '';
        });
        
        // Highlight the highest rework rate(s) in red
        if (highestProcessId && highestRate > 0) {
            // If there are ties, highlight all of them
            ties.forEach(processId => {
                const labels = this.svg.querySelectorAll(`[data-rework-rate="${processId}"]`);
                labels.forEach(label => {
                    label.style.fill = 'red';
                });
            });
        }
    }

makeNameEditable(titleElement, processId) {
    let input = null;
    let isEditing = false;
    
    const startEdit = (evt) => {
        evt.stopPropagation();
        if (isEditing) return;
        isEditing = true;
        
        input = document.createElement('input');
        input.type = 'text';
        input.value = this.currentProcesses[processId].attributes.name || '';
        input.style.position = 'absolute';
        input.style.left = `${evt.clientX - 100}px`; // Wider input for names
        input.style.top = `${evt.clientY - 15}px`;
        input.style.width = '200px'; // Wider input for names
        input.style.height = '25px';
        input.style.fontSize = '14px';
        input.style.textAlign = 'center';
        input.style.border = '1px solid #2c3e50';
        input.style.borderRadius = '4px';

        const saveValue = () => {
            if (!input) return false;
            const newValue = input.value.trim();
            
            if (newValue) {
                // Update the process name
                this.currentProcesses[processId].attributes.name = newValue;
                titleElement.textContent = newValue;
                
                // Update DSL
                this.updateDSLWithProcessAttribute(processId, 'name', `"${newValue}"`);
                
                // Save state to ensure persistence
                this.saveState();
                
                return true;
            }
            return false;
        };

        const cleanup = () => {
            if (input && input.parentNode) {
                input.removeEventListener('keydown', handleKeyDown);
                input.removeEventListener('blur', handleBlur);
                document.body.removeChild(input);
                isEditing = false;
                input = null;
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (saveValue()) {
                    cleanup();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cleanup();
            }
        };

        const handleBlur = () => {
            setTimeout(() => {
                if (saveValue()) {
                    cleanup();
                }
            }, 100);
        };

        input.addEventListener('keydown', handleKeyDown);
        input.addEventListener('blur', handleBlur);
        
        document.body.appendChild(input);
        input.focus();
        input.select();
    };
    
    titleElement.addEventListener('click', startEdit);
}
}