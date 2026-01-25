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

        // Rework flow interaction state
        this.isDraggingRework = false;
        this.reworkDragStart = null;
        this.tempReworkLine = null;
        this.currentReworkFlows = [];
        this.selectedReworkFlow = null;

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
            
            // Add flow value type badge
            this.addFlowValueTypeBadge(flow, labelPosition);
        });
    }

    addFlowValueTypeBadge(flow, labelPosition) {
        // Flows can only be NVA or NNVA (waiting is never value-adding)
        const valueType = flow.value_type || 'NVA';
        const badgeWidth = 35;
        const badgeHeight = 14;
        const badgeX = labelPosition.x - badgeWidth / 2;
        const badgeY = labelPosition.y + 5; // Below the wait time label
        
        // Color coding for value types (no VA for flows)
        const colors = {
            'NVA': { bg: '#e74c3c', text: '#fff' },  // Red for Non-Value Add
            'NNVA': { bg: '#f39c12', text: '#fff' }  // Orange for Necessary Non-Value Add
        };
        
        const color = colors[valueType] || colors['VA'];
        
        // Create badge rectangle
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badge.setAttribute('x', badgeX);
        badge.setAttribute('y', badgeY);
        badge.setAttribute('width', badgeWidth);
        badge.setAttribute('height', badgeHeight);
        badge.setAttribute('rx', '3');
        badge.setAttribute('fill', color.bg);
        badge.setAttribute('class', 'flow-value-type-badge');
        badge.setAttribute('data-flow-from', flow.from);
        badge.setAttribute('data-flow-to', flow.to);
        badge.style.cursor = 'pointer';
        
        // Create badge text
        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', labelPosition.x);
        badgeText.setAttribute('y', badgeY + badgeHeight / 2 + 1);
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('dominant-baseline', 'middle');
        badgeText.setAttribute('font-size', '9');
        badgeText.setAttribute('font-weight', 'bold');
        badgeText.setAttribute('fill', color.text);
        badgeText.setAttribute('class', 'flow-value-type-text');
        badgeText.style.pointerEvents = 'none';
        badgeText.textContent = valueType;
        
        // Add tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        const tooltips = {
            'NVA': 'Non-Value Add: pure waste; can be removed without harming outcome',
            'NNVA': 'Necessary Non-Value Add: not value-add, but currently required due to constraints'
        };
        title.textContent = `${tooltips[valueType] || 'Unknown value type'}\nClick to toggle (flows cannot be VA - waiting is never value-adding)`;
        badge.appendChild(title);
        
        // Click handler to cycle through value types
        badge.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.cycleFlowValueType(flow);
        });
        
        this.svg.appendChild(badge);
        this.svg.appendChild(badgeText);
    }

    cycleFlowValueType(flow) {
        // Flows can only be NVA or NNVA (waiting is never value-adding)
        const currentType = flow.value_type || 'NVA';
        const types = ['NVA', 'NNVA'];
        const currentIndex = types.indexOf(currentType);
        const newType = types[(currentIndex + 1) % types.length];
        
        flow.value_type = newType;
        
        // Update DSL
        this.updateDSLWithFlowValueType(flow);
        
        // Redraw
        this.redrawFlows();
        
        this.saveState();
    }

    updateDSLWithFlowValueType(flow) {
        const editor = document.getElementById('dslEditor');
        if (!editor) return;

        try {
            const data = JSON.parse(editor.value);
            
            // Find and update the flow
            if (data.flows) {
                const flowIndex = data.flows.findIndex(f => f.from === flow.from && f.to === flow.to);
                if (flowIndex !== -1) {
                    data.flows[flowIndex].value_type = flow.value_type;
                }
            }
            
            editor.value = JSON.stringify(data, null, 2);
        } catch (e) {
            console.error('Error updating flow value type in JSON:', e);
        }
    }

    updateDSLWithFlowWaitTime(flow) {
        const editor = document.getElementById('dslEditor');
        if (!editor) return;

        try {
            const data = JSON.parse(editor.value);
            
            // Find and update the flow
            if (data.flows) {
                const flowIndex = data.flows.findIndex(f => f.from === flow.from && f.to === flow.to);
                if (flowIndex !== -1) {
                    data.flows[flowIndex].wait_time = flow.wait_time;
                }
            }
            
            editor.value = JSON.stringify(data, null, 2);
        } catch (e) {
            console.error('Error updating flow wait time in JSON:', e);
        }
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
            
            // Handle rework dragging
            this.dragRework(e);
        });

        // Stop panning on mouse button release
        window.addEventListener('mouseup', (e) => {
            if (e.button === 2 && this.isPanning) {
                this.isPanning = false;
                this.svg.style.cursor = 'default';
                // Save view state after panning
                this.saveViewState();
            }

            // Handle flow drag end
            this.endFlowDrag(e);
            
            // Handle rework drag end
            this.endReworkDrag(e);
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
                
                // Save view state after zooming
                this.saveViewState();
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
            const attributes = [
                { key: 'PT', value: process.attributes.process_time || 'N/A', attr: 'process_time' },
                { key: 'WT', value: process.attributes.wait_time || 'N/A', attr: 'wait_time' },
                { key: 'CT', value: calculatedCT, attr: 'cycle_time', calculated: true }
            ];

            attributes.forEach((attr, i) => {
                const detailText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                detailText.setAttribute('x', pos.x + this.processWidth / 2);
                detailText.setAttribute('y', pos.y + 45 + i * 15);
                detailText.setAttribute('class', 'process-details');
                detailText.textContent = `${attr.key}: ${attr.value}`;
                
                // Make time-based attributes editable (except calculated CT)
                if (attr.attr.includes('time') && !attr.calculated) {
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

            // Value Type badge (VA/NVA/NNVA)
            this.addValueTypeBadge(group, processId, pos, process.attributes.value_type || 'VA');

            // Add plus symbol for adding new processes
            this.addPlusSymbol(group, processId, pos);

            // Add flow connection point (created by helper)
            this.addFlowConnectionPoint(group, processId, pos);
            
            // Add rework connection point at the bottom
            this.addReworkConnectionPoint(group, processId, pos);
            
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
                
                // Update value type badge rect (separate from main process rect)
                const valueTypeBadge = selectedElement.querySelector('.value-type-badge');
                if (valueTypeBadge) {
                    const badgeX = parseFloat(valueTypeBadge.getAttribute('x'));
                    const badgeY = parseFloat(valueTypeBadge.getAttribute('y'));
                    if (!isNaN(badgeX)) {
                        valueTypeBadge.setAttribute('x', badgeX + deltaX);
                    }
                    if (!isNaN(badgeY)) {
                        valueTypeBadge.setAttribute('y', badgeY + deltaY);
                    }
                }

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
                
                // Update the rework connection point so it stays with the process
                const reworkPoint = this.svg.querySelector(`.rework-connection-point[data-rework-connection-for="${processId}"]`);
                if (reworkPoint) {
                    const rwX = newX + this.processWidth / 2;
                    const rwY = newY + this.processHeight; // Halfway across the bottom line
                    const rwCircle = reworkPoint.querySelector('circle');
                    const rwText = reworkPoint.querySelector('text');
                    if (rwCircle) {
                        rwCircle.setAttribute('cx', rwX);
                        rwCircle.setAttribute('cy', rwY);
                    }
                    if (rwText) {
                        rwText.setAttribute('x', rwX);
                        rwText.setAttribute('y', rwY + 1);
                    }
                }
                
                // Update the waste indicator if it belongs to this process
                const wasteIndicator = this.svg.querySelector(`.waste-indicator[data-waste-for="${processId}"]`);
                if (wasteIndicator) {
                    const indicatorX = newX + this.processWidth;
                    const indicatorY = newY;
                    const wasteCircle = wasteIndicator.querySelector('circle');
                    const wasteText = wasteIndicator.querySelector('text');
                    if (wasteCircle) {
                        wasteCircle.setAttribute('cx', indicatorX);
                        wasteCircle.setAttribute('cy', indicatorY);
                    }
                    if (wasteText) {
                        wasteText.setAttribute('x', indicatorX);
                        wasteText.setAttribute('y', indicatorY + 1);
                    }
                }
                
                this.positions[processId] = { x: newX, y: newY };
                this.redrawFlows();
                this.drawReworkFlows();

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
        const editor = document.getElementById('dslEditor');
        try {
            const data = JSON.parse(editor.value);
            
            // Update positions
            data.positions = {};
            Object.entries(this.positions).forEach(([id, pos]) => {
                data.positions[id] = { x: Math.round(pos.x), y: Math.round(pos.y) };
            });
            
            editor.value = JSON.stringify(data, null, 2);
        } catch (e) {
            console.error('Error updating positions in JSON:', e);
        }
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
        this.svg.querySelectorAll('.flow-line, .info-flow-line, .wait-time-label, .flow-value-type-badge, .flow-value-type-text').forEach(el => el.remove());

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
            positions: this.positions,
            reworkFlows: this.currentReworkFlows
        };

        console.log('Rework flows being saved:', this.currentReworkFlows);
        console.log('Full state:', currentState);

        // Update the DSL text with positions
        const dslText = window.parser.serialize(currentState);
        document.getElementById('dslEditor').value = dslText;

        // Save to localStorage as backup
        localStorage.setItem('vsmState', JSON.stringify(currentState));
        
        // Save viewBox state separately so it persists across sessions
        this.saveViewState();
    }
    
    saveViewState() {
        const viewState = {
            viewBox: { ...this.viewBox },
            zoomLevel: this.zoomLevel
        };
        console.log('Saving view state:', viewState);
        localStorage.setItem('vsmViewState', JSON.stringify(viewState));
    }
    
    loadViewState() {
        const savedViewState = localStorage.getItem('vsmViewState');
        console.log('Loading view state:', savedViewState);
        if (savedViewState) {
            try {
                const viewState = JSON.parse(savedViewState);
                if (viewState.viewBox) {
                    this.viewBox = { ...viewState.viewBox };
                    this.zoomLevel = viewState.zoomLevel || 1;
                    const viewBoxStr = `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.width} ${this.viewBox.height}`;
                    console.log('Restoring viewBox to:', viewBoxStr);
                    this.svg.setAttribute('viewBox', viewBoxStr);
                    return true;
                }
            } catch (e) {
                console.error('Error loading view state:', e);
            }
        }
        return false;
    }

    visualize(data, options = {}) {
        console.log('Visualizing data:', data);
        console.log('Rework flows in data:', data.reworkFlows);
        
        this.setupSVG();
        
        this.currentProcesses = data.processes;
        this.currentFlows = data.flows;
        this.currentInfoFlows = data.infoFlows;
        this.currentReworkFlows = data.reworkFlows || [];
        
        console.log('Current rework flows after setting:', this.currentReworkFlows);
        
        // Use existing positions or calculate new ones
        this.positions = data.positions && Object.keys(data.positions).length > 0 
            ? data.positions 
            : this.calculatePositions(data.processes, data.flows);
        
        this.criticalPathData = this.calculateCriticalPath(data.processes, data.flows);
        
        this.drawProcesses(data.processes, this.positions);
        this.drawFlows(data.flows, this.positions);
        this.drawReworkFlows();

        // Ensure controls (add-buttons, connection dots) render above flows
        this.bringControlsToFront();
        
        // Update all timing calculations after loading state
        this.updateTimingCalculations();
        
        // Fit the canvas to show all processes (unless preserveView is set)
        if (!options.preserveView) {
            this.fitCanvasToContent();
        }
        
        // Highlight the highest rework rate
        this.highlightHighestReworkRate();
        this.highlightMostWastefulProcess();

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
                // Apply the saved state (with preserveView to prevent fitCanvasToContent)
                this.visualize(state, { preserveView: true });
                // Try to restore the saved view position
                // If no saved view state exists, fit canvas to content
                if (!this.loadViewState()) {
                    this.fitCanvasToContent();
                }
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
                    
                    // Update the JSON
                    this.updateDSLWithFlowWaitTime(flow);
                    
                    // Update all timing calculations
                    this.updateTimingCalculations();
                    
                    // Save state
                    this.saveState();
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

    makeReworkRateEditable(reworkLabel, rework) {
        reworkLabel.style.cursor = 'pointer';
        
        const startEdit = (evt) => {
            evt.stopPropagation();
            const fromProcess = this.currentProcesses[rework.from];
            if (!fromProcess) return;
            
            const currentRate = fromProcess.attributes.defect_rate || '0';
            
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentRate;
            input.style.position = 'absolute';
            input.style.left = `${evt.clientX - 40}px`;
            input.style.top = `${evt.clientY - 15}px`;
            input.style.width = '80px';
            input.style.height = '25px';
            input.style.fontSize = '12px';
            input.style.textAlign = 'center';
            input.style.border = '1px solid #e74c3c';
            input.style.borderRadius = '4px';
            
            const finishEdit = () => {
                let newValue = input.value.trim();
                
                // Remove % if user included it
                newValue = newValue.replace('%', '');
                
                // Validate: must be a number between 0 and 100
                const numValue = parseFloat(newValue);
                if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
                    // Store as string without % symbol
                    fromProcess.attributes.defect_rate = newValue;
                    reworkLabel.textContent = `Rework: ${newValue}%`;
                    
                    // Update DSL
                    this.updateDSLWithProcessAttribute(rework.from, 'defect_rate', newValue);
                    
                    // Update timing calculations and highlighting
                    this.updateTimingCalculations();
                    
                    // Save state to persist changes
                    this.saveState();
                } else {
                    alert('Rework rate must be a number between 0 and 100');
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
        
        reworkLabel.addEventListener('click', startEdit);
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

    // Add this new method to update process attributes in JSON
    updateDSLWithProcessAttribute(processId, attributeName, value) {
        const editor = document.getElementById('dslEditor');
        try {
            const data = JSON.parse(editor.value);
            
            if (data.processes && data.processes[processId]) {
                // Clean up value - remove quotes if present
                let cleanValue = value;
                if (typeof value === 'string') {
                    cleanValue = value.replace(/^"(.*)"$/, '$1');
                }
                data.processes[processId][attributeName] = cleanValue;
                editor.value = JSON.stringify(data, null, 2);
            }
        } catch (e) {
            console.error('Error updating process attribute in JSON:', e);
        }
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

        // Calculate value-adding process time for PCE (only VA processes)
        // NNVA and NVA are excluded - only true value-adding work counts
        const valueAddingProcessTime = criticalPath
            .reduce((sum, processId) => {
                const process = this.currentProcesses[processId];
                if (process) {
                    const valueType = process.attributes.value_type || 'VA';
                    // Only include VA processes in PCE calculation
                    if (valueType === 'VA') {
                        const ptTime = this.convertTimeToStandardUnit(process.attributes.process_time);
                        return sum + ptTime;
                    }
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

        // Calculate PCE (Process Cycle Efficiency) = (VA Process Time / Total Lead Time) * 100
        // Only counts process time from Value Add processes (excludes NNVA and NVA)
        const pce = totalLeadTime > 0 ? (valueAddingProcessTime / totalLeadTime) * 100 : 0;

        // Create critical path display with process names
        const criticalPathNames = criticalPath.map(processId => {
            const process = this.currentProcesses[processId];
            return process ? (process.attributes.name || processId) : processId;
        });

        // Update the UI
        document.getElementById('totalLeadTime').textContent = `${totalLeadTime.toFixed(1)}d`;
        document.getElementById('totalWaitTime').textContent = `${(totalProcessWaitTime + totalFlowWaitTime).toFixed(1)}d`;
        document.getElementById('totalProcessTime').textContent = `${totalProcessTime.toFixed(1)}d`;
        document.getElementById('pce').textContent = `${pce.toFixed(1)}%`;
        document.getElementById('criticalPath').textContent =
            `${totalLeadTime.toFixed(1)}d (${criticalPathNames.join(' → ')})`;

        // Update critical path styling
        this.updateCriticalPathStyling();

        // Redraw flows to update critical path highlighting
        this.redrawFlows();
        
        // Highlight the most wasteful process
        this.highlightMostWastefulProcess();
    }

    // Add this new method to parse DSL changes
    parseDSLChanges() {
        const dslText = document.getElementById('dslEditor').value;
        const parsedData = window.parser.parse(dslText);
        
        // No time validation needed since CT is calculated as PT + WT
        
        // Update current data if validation passes
        this.currentProcesses = parsedData.processes;
        this.currentFlows = parsedData.flows;
        this.currentReworkFlows = parsedData.reworkFlows || [];
        
        // Update all timing calculations
        this.updateTimingCalculations();
    }

    // Add these new methods to the VSMVisualizer class

    addValueTypeBadge(group, processId, pos, valueType) {
        // Position the badge at bottom-left corner of the process box
        const badgeWidth = 35;
        const badgeHeight = 16;
        const badgeX = pos.x + 5;
        const badgeY = pos.y + this.processHeight - badgeHeight - 5;
        
        // Color coding for value types
        const colors = {
            'VA': { bg: '#27ae60', text: '#fff' },   // Green for Value Add
            'NVA': { bg: '#e74c3c', text: '#fff' },  // Red for Non-Value Add
            'NNVA': { bg: '#f39c12', text: '#fff' }  // Orange for Necessary Non-Value Add
        };
        
        const color = colors[valueType] || colors['VA'];
        
        // Create badge rectangle
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        badge.setAttribute('x', badgeX);
        badge.setAttribute('y', badgeY);
        badge.setAttribute('width', badgeWidth);
        badge.setAttribute('height', badgeHeight);
        badge.setAttribute('rx', '3');
        badge.setAttribute('fill', color.bg);
        badge.setAttribute('class', 'value-type-badge');
        badge.setAttribute('data-process-id', processId);
        badge.style.cursor = 'pointer';
        
        // Create badge text
        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', badgeX + badgeWidth / 2);
        badgeText.setAttribute('y', badgeY + badgeHeight / 2 + 1);
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('dominant-baseline', 'middle');
        badgeText.setAttribute('font-size', '10');
        badgeText.setAttribute('font-weight', 'bold');
        badgeText.setAttribute('fill', color.text);
        badgeText.setAttribute('class', 'value-type-text');
        badgeText.setAttribute('data-process-id', processId);
        badgeText.style.cursor = 'pointer';
        badgeText.style.pointerEvents = 'none';
        badgeText.textContent = valueType;
        
        // Add tooltip
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        const tooltips = {
            'VA': 'Value Add: transforms the product/service in a way the customer is willing to pay for',
            'NVA': 'Non-Value Add: pure waste; can be removed without harming outcome',
            'NNVA': 'Necessary Non-Value Add: not value-add, but currently required due to constraints'
        };
        title.textContent = `${tooltips[valueType] || 'Unknown value type'}\nClick to change`;
        badge.appendChild(title);
        
        // Click handler to cycle through value types
        badge.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.cycleValueType(processId);
        });
        
        group.appendChild(badge);
        group.appendChild(badgeText);
    }

    cycleValueType(processId) {
        const process = this.currentProcesses[processId];
        if (!process) return;
        
        const currentType = process.attributes.value_type || 'VA';
        const types = ['VA', 'NVA', 'NNVA'];
        const currentIndex = types.indexOf(currentType);
        const newType = types[(currentIndex + 1) % types.length];
        
        process.attributes.value_type = newType;
        
        // Update DSL
        this.updateDSLWithProcessAttribute(processId, 'value_type', `"${newType}"`);
        
        // Redraw (preserve current view/zoom)
        this.visualize({
            processes: this.currentProcesses,
            flows: this.currentFlows,
            infoFlows: this.currentInfoFlows,
            reworkFlows: this.currentReworkFlows,
            positions: this.positions
        }, { preserveView: true });
        
        this.saveState();
    }

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
                wait_time: '0.5d',
                value_type: 'NVA'  // Flows are never VA (waiting is non-value-adding)
            };
            this.currentFlows.push(newFlow);
            
            // Calculate position for the new process, avoiding overlaps
            const newPosition = this.findNonOverlappingPosition(pos.x, pos.y);
            this.positions[newId] = newPosition;
            
            // Update the DSL
            this.updateDSLWithNewProcess(newProcess, newId, newFlow);
            
            // Redraw the visualization (preserve current view/zoom)
            this.visualize({
                processes: this.currentProcesses,
                flows: this.currentFlows,
                infoFlows: this.currentInfoFlows,
                positions: this.positions
            }, { preserveView: true });
            this.saveState();
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
        const baseName = baseProcess.attributes.name || 'Process';
        return {
            attributes: {
                stage_id: parseInt(baseProcess.attributes.stage_id || 1) + 1,
                name: `New ${baseName}`,
                owner: baseProcess.attributes.owner || '',
                description: `New process derived from ${baseName}`,
                wait_time: '0d',
                process_time: '0s',
                defect_rate: '0',
                value_type: 'VA'
            }
        };
    }

    updateDSLWithNewProcess(process, processId, flow) {
        const editor = document.getElementById('dslEditor');
        try {
            const data = JSON.parse(editor.value);
            
            // Add new process
            data.processes[processId] = {
                stage_id: process.attributes.stage_id,
                name: process.attributes.name,
                owner: process.attributes.owner,
                description: process.attributes.description,
                wait_time: process.attributes.wait_time,
                process_time: process.attributes.process_time,
                defect_rate: process.attributes.defect_rate,
                value_type: process.attributes.value_type || 'VA'
            };
            
            // Add new flow
            if (!data.flows) data.flows = [];
            data.flows.push({
                from: flow.from,
                to: flow.to,
                wait_time: flow.wait_time,
                value_type: flow.value_type || 'NVA'
            });
            
            // Add position if available
            if (this.positions[processId]) {
                if (!data.positions) data.positions = {};
                data.positions[processId] = {
                    x: Math.round(this.positions[processId].x),
                    y: Math.round(this.positions[processId].y)
                };
            }
            
            editor.value = JSON.stringify(data, null, 2);
        } catch (e) {
            console.error('Error adding new process to JSON:', e);
        }
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
                } else if (this.selectedReworkFlow) {
                    this.deleteSelectedReworkFlow();
                }
            }
    });

    // Deselect flow when clicking on canvas background
    this.svg.addEventListener('click', (evt) => {
            if (evt.target === this.svg || evt.target.tagName === 'svg') {
                this.deselectFlow();
                this.deselectProcess();
                this.deselectReworkFlow();
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

selectReworkFlow(rework, element, evt) {
    evt.stopPropagation();

    // Deselect previous selections
    this.deselectFlow();
    this.deselectProcess();
    this.deselectReworkFlow();

    // Select this rework flow
    this.selectedReworkFlow = {
        from: rework.from,
        to: rework.to,
        element: element
    };
    element.classList.add('selected');
}

deselectReworkFlow() {
    if (this.selectedReworkFlow && this.selectedReworkFlow.element) {
        this.selectedReworkFlow.element.classList.remove('selected');
    }
    this.selectedReworkFlow = null;
}

deleteSelectedReworkFlow() {
    if (!this.selectedReworkFlow) return;

    const {from, to} = this.selectedReworkFlow;

    // Remove from array
    this.currentReworkFlows = this.currentReworkFlows.filter(
        rf => !(rf.from === from && rf.to === to)
    );

    // Clear selection
    this.deselectReworkFlow();

    // Redraw and save
    this.drawReworkFlows();
    this.saveState();
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

        // Remove process from data
        if (this.currentProcesses && this.currentProcesses[id]) {
            delete this.currentProcesses[id];
        }

        // Remove any flows that reference this process
        this.currentFlows = this.currentFlows.filter(f => f.from !== id && f.to !== id);
        this.currentInfoFlows = this.currentInfoFlows.filter(f => f.from !== id && f.to !== id);
        
        // Remove any rework flows that reference this process
        if (this.currentReworkFlows) {
            this.currentReworkFlows = this.currentReworkFlows.filter(f => f.from !== id && f.to !== id);
        }

        // Remove position entry
        if (this.positions && this.positions[id]) delete this.positions[id];

        // Clear selection
        this.selectedProcess = null;

        // Remove the process DOM elements (group contains rect, text, badges)
        const processRect = this.svg.querySelector(`rect[data-process-id="${id}"]`);
        if (processRect && processRect.parentElement) {
            processRect.parentElement.remove();
        }

        // Remove control elements from the controls layer
        // Add Process button (circle and plus text)
        this.svg.querySelectorAll(`[data-add-for="${id}"]`).forEach(el => el.remove());
        // Flow connection point
        this.svg.querySelectorAll(`[data-connection-for="${id}"]`).forEach(el => el.remove());
        // Rework connection point
        this.svg.querySelectorAll(`[data-rework-connection-for="${id}"]`).forEach(el => el.remove());

        // Redraw flows and rework flows (to remove any connected to deleted process)
        this.redrawFlows();
        this.drawReworkFlows();

        // Update timing calculations
        this.updateTimingCalculations();
        
        // Update highlights
        this.highlightHighestReworkRate();
        this.highlightMostWastefulProcess();

        // Ensure controls layer stays on top
        this.bringControlsToFront();

        // Persist state
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

    try {
        const data = JSON.parse(editor.value);
        
        // Remove the flow
        if (data.flows) {
            data.flows = data.flows.filter(f => !(f.from === fromId && f.to === toId));
        }
        
        editor.value = JSON.stringify(data, null, 2);
    } catch (e) {
        console.error('Error removing flow from JSON:', e);
    }
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

addReworkConnectionPoint(group, processId, pos) {
    const connectionRadius = 10;
    // Position halfway across the bottom line of the process box
    const x = pos.x + this.processWidth / 2;
    const y = pos.y + this.processHeight;

    // Create a group for the rework connection control
    const reworkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    reworkGroup.setAttribute('class', 'rework-connection-point');
    reworkGroup.setAttribute('data-rework-connection-for', processId);

    // Circle (styled with dashed stroke to indicate rework)
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', connectionRadius);
    circle.setAttribute('fill', 'white');
    circle.setAttribute('stroke', '#e74c3c'); // Red color for rework
    circle.setAttribute('stroke-width', '2');
    circle.setAttribute('stroke-dasharray', '3,3'); // Dashed stroke
    circle.style.opacity = '0.9';

    // 'R' symbol for Rework
    const rText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    rText.setAttribute('x', x);
    rText.setAttribute('y', y + 1);
    rText.setAttribute('text-anchor', 'middle');
    rText.setAttribute('dominant-baseline', 'middle');
    rText.setAttribute('font-size', '12');
    rText.setAttribute('font-weight', 'bold');
    rText.setAttribute('class', 'rework-connection-symbol');
    rText.style.cursor = 'pointer';
    rText.style.fill = '#e74c3c';
    rText.textContent = 'R';

    reworkGroup.appendChild(circle);
    reworkGroup.appendChild(rText);

    // Make everything interactive
    reworkGroup.style.pointerEvents = 'auto';
    reworkGroup.style.cursor = 'pointer';

    // Start rework drag when clicking the control
    reworkGroup.addEventListener('mousedown', (evt) => {
        evt.stopPropagation();
        this.startReworkDrag(evt, processId);
    });

    // Append the rework connection point group to the controls layer
    const controlsLayer = this.svg.querySelector('#controls-layer') || this.svg;
    controlsLayer.appendChild(reworkGroup);
}

    // Helper to generate a new unique process id based on a base id.
    generateProcessIdFromName(processName) {
        // Convert process name to a slug (lowercase, underscores)
        const slug = processName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')  // Replace non-alphanumeric with underscore
            .replace(/^_+|_+$/g, '');     // Remove leading/trailing underscores
        
        // Generate timestamp in format DDMMYYYYHHMMSS
        const now = new Date();
        const dd = String(now.getDate()).padStart(2, '0');
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const yyyy = String(now.getFullYear());
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        const timestamp = `${dd}${mm}${yyyy}${hh}${min}${ss}`;
        
        let candidate = `${slug}_${timestamp}`;
        
        // Handle collisions (unlikely but possible)
        if (this.currentProcesses && this.currentProcesses[candidate]) {
            let counter = 1;
            while (this.currentProcesses[`${candidate}_${counter}`]) {
                counter++;
                if (counter > 100) break; // Safety cap
            }
            candidate = `${candidate}_${counter}`;
        }
        
        return candidate;
    }

    refactorProcessId(oldId, newId, newName) {
        console.log(`refactorProcessId called: ${oldId} -> ${newId}, name: ${newName}`);
        
        // Don't do anything if IDs are the same
        if (oldId === newId) {
            console.log('IDs are the same, skipping refactor');
            this.currentProcesses[oldId].attributes.name = newName;
            this.updateDSLWithProcessAttribute(oldId, 'name', `"${newName}"`);
            this.saveState();
            return;
        }

        console.log('Refactoring process ID...');
        
        // 1. Update the process in currentProcesses
        this.currentProcesses[newId] = { ...this.currentProcesses[oldId] };
        this.currentProcesses[newId].attributes.name = newName;
        delete this.currentProcesses[oldId];

        // 2. Update all flow references (from/to)
        this.currentFlows.forEach(flow => {
            if (flow.from === oldId) flow.from = newId;
            if (flow.to === oldId) flow.to = newId;
        });

        // 3. Update all rework flow references
        if (this.currentReworkFlows) {
            this.currentReworkFlows.forEach(rework => {
                if (rework.from === oldId) rework.from = newId;
                if (rework.to === oldId) rework.to = newId;
            });
        }

        // 4. Update all info flow references
        if (this.currentInfoFlows) {
            this.currentInfoFlows.forEach(infoFlow => {
                if (infoFlow.from === oldId) infoFlow.from = newId;
                if (infoFlow.to === oldId) infoFlow.to = newId;
            });
        }

        // 5. Update positions
        this.positions[newId] = this.positions[oldId];
        delete this.positions[oldId];

        // 6. Update selected items if they reference the old ID
        if (this.selectedProcess === oldId) {
            this.selectedProcess = newId;
        }
        if (this.selectedFlow) {
            if (this.selectedFlow.from === oldId) this.selectedFlow.from = newId;
            if (this.selectedFlow.to === oldId) this.selectedFlow.to = newId;
        }
        if (this.selectedReworkFlow) {
            if (this.selectedReworkFlow.from === oldId) this.selectedReworkFlow.from = newId;
            if (this.selectedReworkFlow.to === oldId) this.selectedReworkFlow.to = newId;
        }

        // 7. Rebuild the entire DSL with updated IDs
        this.rebuildDSL();

        // 8. Redraw the visualization (preserve current view/zoom)
        this.visualize({
            processes: this.currentProcesses,
            flows: this.currentFlows,
            infoFlows: this.currentInfoFlows,
            reworkFlows: this.currentReworkFlows,
            positions: this.positions
        }, { preserveView: true });

        // 9. Save state
        this.saveState();
    }

    rebuildDSL() {
        const editor = document.getElementById('dslEditor');
        if (!editor) return;

        const data = {
            processes: {},
            flows: [],
            reworkFlows: [],
            positions: {}
        };

        // Add all processes
        Object.entries(this.currentProcesses).forEach(([processId, process]) => {
            data.processes[processId] = {
                stage_id: process.attributes.stage_id,
                name: process.attributes.name,
                owner: process.attributes.owner,
                description: process.attributes.description,
                wait_time: process.attributes.wait_time,
                process_time: process.attributes.process_time,
                defect_rate: process.attributes.defect_rate,
                value_type: process.attributes.value_type || 'VA'
            };
        });

        // Add all flows
        this.currentFlows.forEach(flow => {
            data.flows.push({
                from: flow.from,
                to: flow.to,
                wait_time: flow.wait_time || '0d',
                value_type: flow.value_type || 'NVA'
            });
        });

        // Add all rework flows
        if (this.currentReworkFlows) {
            this.currentReworkFlows.forEach(rework => {
                data.reworkFlows.push({
                    from: rework.from,
                    to: rework.to,
                    rework_rate: rework.rework_rate || '0'
                });
            });
        }

        // Add positions
        Object.entries(this.positions).forEach(([processId, pos]) => {
            data.positions[processId] = {
                x: Math.round(pos.x),
                y: Math.round(pos.y)
            };
        });

        editor.value = JSON.stringify(data, null, 2);
    }

    generateNewProcessId(baseId) {
        const baseProcess = this.currentProcesses[baseId];
        const processName = baseProcess?.attributes?.name || 'process';
        return this.generateProcessIdFromName(processName);
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

startReworkDrag(evt, fromProcessId) {
    this.isDraggingRework = true;

    // Get the rework connection point coordinates
    let startX = null, startY = null;
    if (evt && evt.target) {
        let el = null;
        try { el = evt.target.closest('.rework-connection-point'); } catch (e) { el = null; }
        if (el && el.classList && el.classList.contains('rework-connection-point')) {
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

    this.reworkDragStart = {
        processId: fromProcessId,
        x: startX,
        y: startY
    };

    // Create temporary line (dotted)
    this.tempReworkLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.tempReworkLine.setAttribute('class', 'temp-rework-line');
    this.tempReworkLine.setAttribute('stroke', '#e74c3c');
    this.tempReworkLine.setAttribute('stroke-width', '2');
    this.tempReworkLine.setAttribute('stroke-dasharray', '5,5');
    this.tempReworkLine.setAttribute('fill', 'none');
    this.svg.appendChild(this.tempReworkLine);

    evt.preventDefault();
}

dragRework(evt) {
    if (!this.isDraggingRework || !this.tempReworkLine) return;

    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());

    // Draw line from start to current position
    const path = `M ${this.reworkDragStart.x} ${this.reworkDragStart.y} L ${svgP.x} ${svgP.y}`;
    this.tempReworkLine.setAttribute('d', path);

    // Check if over a valid target (can connect to any process except self)
    const targetProcess = this.getProcessAtPoint(svgP.x, svgP.y);
    if (targetProcess && targetProcess !== this.reworkDragStart.processId) {
        this.tempReworkLine.setAttribute('stroke', '#27ae60'); // Green when valid
    } else {
        this.tempReworkLine.setAttribute('stroke', '#e74c3c'); // Red when invalid
    }
}

endReworkDrag(evt) {
    if (!this.isDraggingRework) return;

    const pt = this.svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const svgP = pt.matrixTransform(this.svg.getScreenCTM().inverse());

    // Check if over a valid target
    const targetProcess = this.getProcessAtPoint(svgP.x, svgP.y);
    if (targetProcess && targetProcess !== this.reworkDragStart.processId) {
        this.createReworkFlow(this.reworkDragStart.processId, targetProcess);
    }

    // Cleanup
    if (this.tempReworkLine) {
        this.svg.removeChild(this.tempReworkLine);
        this.tempReworkLine = null;
    }
    this.isDraggingRework = false;
    this.reworkDragStart = null;
}

createReworkFlow(fromId, toId) {
    // Check if rework flow already exists
    const exists = this.currentReworkFlows.some(rf => rf.from === fromId && rf.to === toId);
    if (exists) {
        console.log('Rework flow already exists from', fromId, 'to', toId);
        return;
    }

    // Add the rework flow
    console.log('Creating rework flow from', fromId, 'to', toId);
    this.currentReworkFlows.push({ from: fromId, to: toId });
    console.log('Current rework flows:', this.currentReworkFlows);

    // Redraw
    this.drawReworkFlows();

    // Save state
    this.saveState();
}

drawReworkFlows() {
    console.log('Drawing rework flows:', this.currentReworkFlows);
    
    // Save selected rework flow IDs if one is selected
    const selectedReworkIds = this.selectedReworkFlow ? {
        from: this.selectedReworkFlow.from,
        to: this.selectedReworkFlow.to
    } : null;

    // Clear selection reference before removing elements
    if (this.selectedReworkFlow) {
        this.selectedReworkFlow = null;
    }
    
    // Remove existing rework flow groups and labels
    const existingRework = this.svg.querySelectorAll('.rework-flow-group, .rework-rate-label');
    existingRework.forEach(el => el.remove());

    // Check if currentReworkFlows exists and has content
    if (!this.currentReworkFlows || this.currentReworkFlows.length === 0) {
        console.log('No rework flows to draw');
        return;
    }

    // Get the first non-defs child to insert before (so rework lines render behind process boxes but after defs)
    let insertBeforeNode = this.svg.firstChild;
    while (insertBeforeNode && insertBeforeNode.tagName === 'defs') {
        insertBeforeNode = insertBeforeNode.nextSibling;
    }

    // Draw each rework flow
    this.currentReworkFlows.forEach(rework => {
        console.log('Drawing rework flow from', rework.from, 'to', rework.to);
        const fromPos = this.positions[rework.from];
        const toPos = this.positions[rework.to];
        if (!fromPos || !toPos) return;

        // Start from bottom of source process (at the rework connection point)
        const startX = fromPos.x + this.processWidth / 2;
        const startY = fromPos.y + this.processHeight;

        // End at bottom of target process (at the rework connection point)
        const endX = toPos.x + this.processWidth / 2;
        const endY = toPos.y + this.processHeight;

        // Create a curved path that goes down and across
        const midY = Math.max(startY, endY) + 30;
        const path = `M ${startX} ${startY} Q ${startX} ${midY}, ${(startX + endX) / 2} ${midY} T ${endX} ${endY}`;

        // Create a group to hold both the hit area and visible line
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', 'rework-flow-group');

        // Create the visible dotted line
        const reworkLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        reworkLine.setAttribute('d', path);
        reworkLine.setAttribute('class', 'rework-flow-line');
        reworkLine.setAttribute('data-rework-from', rework.from);
        reworkLine.setAttribute('data-rework-to', rework.to);
        reworkLine.style.pointerEvents = 'none'; // Visual only

        // Create an invisible wider path for easier clicking
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', path);
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '20');
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('cursor', 'pointer');
        hitArea.setAttribute('data-rework-from', rework.from);
        hitArea.setAttribute('data-rework-to', rework.to);

        // Add click handler to the hit area
        hitArea.addEventListener('click', (evt) => {
            evt.stopPropagation();
            this.selectReworkFlow(rework, reworkLine, evt);
        });

        // Add both to the group
        group.appendChild(reworkLine);
        group.appendChild(hitArea);

        // Insert the group at the beginning (behind process boxes)
        this.svg.insertBefore(group, insertBeforeNode);

        // Add rework rate label on the line
        const fromProcess = this.currentProcesses[rework.from];
        if (fromProcess) {
            const defectRate = fromProcess.attributes.defect_rate || '0';
            
            // Calculate label position (below the curved path with padding)
            const labelX = (startX + endX) / 2;
            const labelY = midY + 15; // Position below the line with 15px padding
            
            const reworkLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            reworkLabel.setAttribute('x', labelX);
            reworkLabel.setAttribute('y', labelY);
            reworkLabel.setAttribute('class', 'rework-rate-label');
            reworkLabel.setAttribute('text-anchor', 'middle');
            reworkLabel.setAttribute('fill', '#e74c3c');
            reworkLabel.setAttribute('font-weight', 'bold');
            reworkLabel.setAttribute('font-size', '12');
            reworkLabel.setAttribute('data-rework-from', rework.from);
            reworkLabel.setAttribute('data-rework-to', rework.to);
            reworkLabel.textContent = `Rework: ${defectRate}%`;
            
            // Make the rework rate editable
            this.makeReworkRateEditable(reworkLabel, rework);
            
            this.svg.appendChild(reworkLabel);
        }
    });

    // Restore selection if there was one
    if (selectedReworkIds) {
        const reworkLineToSelect = this.svg.querySelector(
            `.rework-flow-line[data-rework-from="${selectedReworkIds.from}"][data-rework-to="${selectedReworkIds.to}"]`
        );
        if (reworkLineToSelect) {
            const rework = this.currentReworkFlows.find(
                rf => rf.from === selectedReworkIds.from && rf.to === selectedReworkIds.to
            );
            if (rework) {
                this.selectedReworkFlow = {
                    from: rework.from,
                    to: rework.to,
                    element: reworkLineToSelect
                };
                reworkLineToSelect.classList.add('selected');
            }
        }
    }
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
        wait_time: '0d',
        value_type: 'NVA'  // Flows are never VA (waiting is non-value-adding)
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

    try {
        const data = JSON.parse(editor.value);
        
        // Add the new flow
        if (!data.flows) data.flows = [];
        data.flows.push({
            from: flow.from,
            to: flow.to,
            wait_time: flow.wait_time || '0d',
            value_type: flow.value_type || 'NVA'
        });
        
        editor.value = JSON.stringify(data, null, 2);
    } catch (e) {
        console.error('Error adding flow to JSON:', e);
    }
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
    this.svg.querySelectorAll('.flow-line, .info-flow-line, .wait-time-label, .flow-value-type-badge, .flow-value-type-text').forEach(el => el.remove());

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
        input.value = this.currentProcesses[processId].attributes[attributeName] || '';
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
            const newValue = input.value.trim();
            
            if (validateValue(newValue)) {
                // Update the process attribute
                this.currentProcesses[processId].attributes[attributeName] = newValue;
                textElement.textContent = `${displayPrefix}: ${newValue}`;
                
                // Update DSL and recalculate everything
                this.updateDSLWithProcessAttribute(processId, attributeName, newValue);
                this.updateTimingCalculations();

                // Redraw the visualization (preserve current view/zoom)
                this.visualize({
                    processes: this.currentProcesses,
                    flows: this.currentFlows,
                    infoFlows: this.currentInfoFlows,
                    positions: this.positions
                }, { preserveView: true });
                
                // Save state to persist changes
                this.saveState();
                
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
     * Highlight the rework connection with the highest rework rate
     */
    highlightHighestReworkRate() {
        // Only highlight if there are rework flows
        if (!this.currentReworkFlows || this.currentReworkFlows.length === 0) return;
        
        const processes = this.currentProcesses || {};
        
        // Find the rework connection with the highest rate
        let highestRate = -1;
        let highestReworks = [];
        
        this.currentReworkFlows.forEach(rework => {
            const fromProcess = processes[rework.from];
            if (fromProcess) {
                const rate = parseFloat(fromProcess.attributes.defect_rate || '0');
                if (!isNaN(rate)) {
                    if (rate > highestRate) {
                        highestRate = rate;
                        highestReworks = [rework];
                    } else if (rate === highestRate && rate > 0) {
                        highestReworks.push(rework);
                    }
                }
            }
        });
        
        // Clear previous highlighting from all rework rate labels
        const allReworkLabels = this.svg.querySelectorAll('.rework-rate-label');
        allReworkLabels.forEach(label => {
            label.setAttribute('fill', '#e74c3c');
            label.setAttribute('font-weight', 'bold');
        });
        
        // Highlight the highest rework rate(s) with red and extra bold
        if (highestReworks.length > 0 && highestRate > 0) {
            highestReworks.forEach(rework => {
                const label = this.svg.querySelector(
                    `.rework-rate-label[data-rework-from="${rework.from}"][data-rework-to="${rework.to}"]`
                );
                if (label) {
                    label.setAttribute('fill', '#c0392b');
                    label.setAttribute('font-weight', 'bolder');
                    label.setAttribute('font-size', '13');
                }
            });
        }
    }

    highlightMostWastefulProcess() {
        const processes = this.currentProcesses || {};
        
        if (Object.keys(processes).length === 0) return;
        
        // Remove existing waste indicators
        const existingIndicators = this.svg.querySelectorAll('.waste-indicator');
        existingIndicators.forEach(indicator => indicator.remove());
        
        // Calculate PCE for each process
        let lowestPCE = Infinity;
        let mostWastefulProcessId = null;
        const pceValues = {};
        
        Object.entries(processes).forEach(([processId, process]) => {
            const processTime = this.convertTimeToStandardUnit(process.attributes.process_time || '0');
            const waitTime = this.convertTimeToStandardUnit(process.attributes.wait_time || '0');
            const totalTime = processTime + waitTime;
            
            // Calculate per-process PCE
            const pce = totalTime > 0 ? (processTime / totalTime) * 100 : 100;
            pceValues[processId] = pce;
            
            // Find the process with lowest PCE (most wasteful)
            if (pce < lowestPCE) {
                lowestPCE = pce;
                mostWastefulProcessId = processId;
            }
        });
        
        // Only highlight if there's meaningful waste (PCE < 100%)
        if (mostWastefulProcessId && lowestPCE < 100) {
            const pos = this.positions[mostWastefulProcessId];
            const process = processes[mostWastefulProcessId];
            if (!pos || !process) return;
            
            // Calculate times for the tooltip
            const processTime = this.convertTimeToStandardUnit(process.attributes.process_time || '0');
            const waitTime = this.convertTimeToStandardUnit(process.attributes.wait_time || '0');
            const processName = process.attributes.name || mostWastefulProcessId;
            
            // Create a group for the waste indicator
            const indicatorGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            indicatorGroup.setAttribute('class', 'waste-indicator');
            indicatorGroup.setAttribute('data-waste-for', mostWastefulProcessId);
            indicatorGroup.style.cursor = 'help';
            
            // Position over the top-right corner of the process box
            const indicatorX = pos.x + this.processWidth;
            const indicatorY = pos.y;
            
            // Create red circle
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', indicatorX);
            circle.setAttribute('cy', indicatorY);
            circle.setAttribute('r', '12');
            circle.setAttribute('fill', '#e74c3c');
            circle.setAttribute('stroke', '#fff');
            circle.setAttribute('stroke-width', '2.5');
            
            // Create exclamation mark
            const exclamation = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            exclamation.setAttribute('x', indicatorX);
            exclamation.setAttribute('y', indicatorY + 1);
            exclamation.setAttribute('text-anchor', 'middle');
            exclamation.setAttribute('dominant-baseline', 'middle');
            exclamation.setAttribute('font-size', '16');
            exclamation.setAttribute('font-weight', 'bold');
            exclamation.setAttribute('fill', '#fff');
            exclamation.textContent = '!';
            
            // Add detailed title for tooltip
            const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            title.textContent = `⚠️ MOST WASTEFUL PROCESS ⚠️
Process: ${processName}
Process-Level PCE: ${lowestPCE.toFixed(1)}%

Process Time: ${processTime.toFixed(2)}d (value-added)
Wait Time: ${waitTime.toFixed(2)}d (waste)
Total Time: ${(processTime + waitTime).toFixed(2)}d

This process has the lowest ratio of value-added time.
Focus improvement efforts here to reduce wait time.`;
            
            indicatorGroup.appendChild(title);
            indicatorGroup.appendChild(circle);
            indicatorGroup.appendChild(exclamation);
            
            this.svg.appendChild(indicatorGroup);
        }
    }

makeNameEditable(titleElement, processId) {
    let input = null;
    let isEditing = false;
    let hasSaved = false;
    
    const startEdit = (evt) => {
        evt.stopPropagation();
        if (isEditing) return;
        isEditing = true;
        hasSaved = false;
        
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
            if (!input || hasSaved) return false;
            const newValue = input.value.trim();
            
            if (newValue && this.currentProcesses[processId]) {
                const oldName = this.currentProcesses[processId].attributes.name;
                
                // If the name changed, update process ID based on new name
                if (newValue !== oldName) {
                    hasSaved = true;
                    const newProcessId = this.generateProcessIdFromName(newValue);
                    console.log(`Renaming process: "${oldName}" -> "${newValue}"`);
                    console.log(`Changing ID: ${processId} -> ${newProcessId}`);
                    
                    // Refactor the process ID throughout the system
                    this.refactorProcessId(processId, newProcessId, newValue);
                    
                    return true;
                } else {
                    // Name didn't change, just update DSL to be safe
                    hasSaved = true;
                    this.updateDSLWithProcessAttribute(processId, 'name', `"${newValue}"`);
                    this.saveState();
                    return true;
                }
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
    titleElement.style.cursor = 'pointer';
}
}