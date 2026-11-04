(function () {
  'use strict';
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function show({ui, result, onConfirm, onText}) {
    const layout = result.layout, sessionId = ui.getSessionId();
    const row = make('div', undefined, 'ai-msg ai-msg-assistant');
    const panel = make('section', undefined, 'ai-msg-bubble image-layout');
    panel.append(make('strong', '图片布局 · 待核对'));
    panel.append(make('p', `${layout.grid.columns} 列 × ${layout.grid.rows} 行小格；有内容 ${layout.occupiedCells} 格，空白 ${layout.emptyCells} 格；连续同色区域 ${layout.regions.length} 个。`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${layout.grid.columns * 20} ${layout.grid.rows * 20}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '识别出的布局，虚线格为空白；数字为同色区域编号');
    for (const cell of layout.cells) {
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [key, value] of Object.entries({x:cell.column*20+1,y:cell.row*20+1,width:18,height:18,fill:cell.occupied?`rgb(${cell.rgb.join(',')})`:'#fff',stroke:'#748491','stroke-width':.4})) rect.setAttribute(key, String(value));
      if (!cell.occupied) rect.setAttribute('stroke-dasharray','2 2');
      svg.append(rect);
    }
    for (const region of layout.regions) {
      const text = document.createElementNS(svg.namespaceURI, 'text');
      text.setAttribute('x', String((region.column + .5)*20));
      text.setAttribute('y', String((region.row + .75)*20));
      text.setAttribute('font-size','11');text.setAttribute('fill','#27343D');
      text.textContent = String(region.id); svg.append(text);
    }
    panel.append(svg);
    const details = make('details'), list = make('ul');
    details.append(make('summary','查看各区域位置与大小'));
    for (const r of layout.regions) list.append(make('li',`${r.id}：第 ${r.column+1} 列、第 ${r.row+1} 行起，宽 ${r.columns} × 高 ${r.rows} 格，共 ${r.cellCount} 格${r.rectangular?'':'（非矩形）'}`));
    details.append(list);panel.append(details);
    for (const warning of layout.warnings || []) panel.append(make('p', warning, 'image-layout-note'));
    const meaningLabel = make('label', '请确认图中含义 '), meaning = make('select');
    meaning.setAttribute('aria-label', '图片小格与颜色含义');
    for (const [value,label] of [['','请选择'],['module-cabinet','小格是模组，同色连续区域是箱体'],['module-group','小格是模组，同色区域仅为走线分组'],['cabinet-group','小格是箱体，同色区域仅为走线分组']]) {
      const option=make('option',label);option.value=value;meaning.append(option);
    }
    meaningLabel.append(meaning);panel.append(meaningLabel);
    const cardLabel = make('label'), card = make('input');card.type='checkbox';
    cardLabel.append(card,document.createTextNode('每个箱体一张接收卡（需你确认）'));panel.append(cardLabel);
    const status = make('p','核对正确后填入配单草稿；不会自动发送或生成正式配单。','image-layout-note');
    const actions = make('div',undefined,'image-layout-actions'), confirm=make('button','确认布局，填入草稿'), textOnly=make('button','只使用识别文字');
    confirm.type=textOnly.type='button';confirm.disabled=true;
    function refresh() {card.disabled=meaning.value==='module-group'||!meaning.value;if(card.disabled)card.checked=false;confirm.disabled=!meaning.value;}
    meaning.addEventListener('change',refresh);refresh();
    function current() {
      if (ui.getSessionId()===sessionId) return true;
      status.textContent='当前对话已切换，请在本对话重新上传图片。';confirm.disabled=textOnly.disabled=true;return false;
    }
    confirm.addEventListener('click',()=>{
      if (!current() || !meaning.value) return;
      const semantic=meaning.selectedOptions[0].textContent;
      const lines=['客户已核对的图片布局（不是工具计算结论）：',semantic,`坐标从左到右、从上到下，以下列/行均从1开始。总网格 ${layout.grid.columns}列×${layout.grid.rows}行，有内容${layout.occupiedCells}格，空白${layout.emptyCells}格；空白不计入模组或箱体数量。`,...layout.regions.map(r=>`区域${r.id}：起点列${r.column+1}行${r.row+1}，宽${r.columns}格×高${r.rows}格，实际${r.cellCount}格${r.rectangular?'':'，非矩形，不能用外接矩形代替'}`),card.checked?'客户确认：每个箱体一张接收卡。':'每箱接收卡数量未确认。','模组像素、扫描、接口、接收卡及处理器条件仍需确认。图中颜色和OCR文字不能作为设备带载依据。非矩形/混合箱体若计算工具不支持，应明确说明，禁止按实心矩形替代。'];
      const summary=lines.join('\n');
      if (summary.length>8000) {status.textContent='区域过多，超出当前描述容量。请裁剪目标屏体后重新上传；没有截断或发送布局。';return;}
      onConfirm(summary);status.textContent='布局已填入原始描述栏。可补充模组参数，再点击发送；尚未计算设备或生成SSM。';
    });
    textOnly.addEventListener('click',()=>{if(current()){onText();status.textContent='识别文字已放入原始描述栏，布局未确认。';}});
    actions.append(confirm,textOnly);panel.append(status,actions);row.append(panel);ui.messages.append(row);row.scrollIntoView({block:'nearest'});
  }
  window.V2ImageLayout=Object.freeze({show});
})();
