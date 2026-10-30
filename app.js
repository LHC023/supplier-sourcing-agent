/* ============================================================
   统一数据模型：每条寻源结果 = 一个供应商报价记录
   {name,country,unitPrice,priceUnit,duration,qualification,
    similarProjects,region,score,contact,source,priceBasis}
   ============================================================ */

const INDUSTRIES = CFG.INDUSTRIES;
const PROF_CATS = CFG.PROF_CATS; // 16类
const LABOR_CATS = CFG.LABOR_CATS; // 10类

const COUNTRIES = CFG.COUNTRIES;

const DIAL = CFG.DIAL;
const FOREIGN_CH = CFG.FOREIGN_CH;

const TABS = [
  {id:"material", label:"物料供应商寻源", ic:"🏗️"},
  {id:"profb",    label:"专业分包供应商寻源", ic:"👷"},
  {id:"labor",    label:"劳务分包供应商寻源", ic:"🧱"}
];

let state = { tab:"material", industries:new Set(["建筑业"]), subCats:new Set(), mode:"demo", lastRows:[], query:"", template:"制造版" };

/* ---------- 工具：字符串 -> 稳定种子，保证同一查询结果可复现（可追溯性） ---------- */
function seedOf(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function rng(seed){let s=seed>>>0;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}

/* ---------- 真实感供应商名称池（按行业/专业组合） ---------- */
const BRAND_PREFIX = CFG.BRAND_PREFIX;
const BRAND_MID = CFG.BRAND_MID;
const BRAND_SUFFIX_MAT = CFG.BRAND_SUFFIX_MAT;
const BRAND_SUFFIX_SUB = CFG.BRAND_SUFFIX_SUB;
function pickName(rnd,suffixes,branch){
  return BRAND_PREFIX[Math.floor(rnd()*BRAND_PREFIX.length)]+BRAND_MID[Math.floor(rnd()*BRAND_MID.length)]+
    suffixes[Math.floor(rnd()*suffixes.length)]+ (branch&&rnd()>0.6?"（"+branch+"）":"");
}
const REGIONS = CFG.REGIONS;
const QUALS = CFG.QUALS;

/* 价格基准（元/计价单位）——按 tab 与类别粗基准，供样例生成 */
const PRICE_BASE = CFG.PRICE_BASE;
const PLAT = CFG.PLAT;
function priceBasis(rnd,tab){
  const m=["钢厂2026Q2挂牌价+加工费","信息价(造价信息网)+下浮率","历史成交均价±区间","厂家目录价×行业折扣",
    "同规格近3月招投标中标价","平台在售SKU报价中位数","市场询价3家均值","定额价×人材机调差"];
  return m[Math.floor(rnd()*m.length)];
}

/* ---------- 生成一批样例供应商（≥3，同类匹配） ---------- */
function genSuppliers(){
  const q=(document.getElementById("query").value||state.tab).trim();
  const cnt=Math.max(3,Math.min(12,parseInt(document.getElementById("minCount").value)||5));
  const country=document.getElementById("country").value||"CN";
  const cObj=COUNTRIES.find(c=>c.code===country)||COUNTRIES[0];
  const rnd=rng(seedOf(q+"|"+state.tab+"|"+[...state.industries].join()+[...state.subCats].join()+"|"+country+"|"+document.getElementById("priceUnit").value));
  const base=PRICE_BASE[state.tab];
  const suffixes = state.tab==="material"?BRAND_SUFFIX_MAT:BRAND_SUFFIX_SUB;
  const cats = state.tab==="profb"?(state.subCats.size?[...state.subCats]:PROF_CATS):
               state.tab==="labor"?(state.subCats.size?[...state.subCats]:LABOR_CATS):[...state.industries];
  const rows=[];
  const used=new Set();
  for(let i=0;i<cnt;i++){
    // 国别：多数为采购国本土，掺入跨境源头厂（呼应"国别识别搜该国资源"）
    const isLocal = rnd()<0.62;
    const supplierCountry = isLocal?cObj:(COUNTRIES[Math.floor(rnd()*COUNTRIES.length)]);
    const isCN=supplierCountry.code==="CN";
    const region=isCN?REGIONS[Math.floor(rnd()*4)]:supplierCountry.name+"（当地）";
    let name=pickName(rnd,suffixes,isCN?region:supplierCountry.name); let guard=0;
    while(used.has(name)&&guard++<20) name=pickName(rnd,suffixes,isCN?region:supplierCountry.name);
    used.add(name);
    const unitPrice=Math.round(base.min+rnd()*(base.max-base.min));
    const duration=Math.round((state.tab==="material"? (5+rnd()*60):(20+rnd()*160)));
    const qual=QUALS[Math.floor(rnd()*QUALS.length)];
    const perf=Math.round(rnd()* (qual==="特级"?60:qual==="一级"?45:25)+2);
    const score=Math.round(62+rnd()*36);
    const cat=cats[Math.floor(rnd()*cats.length)];
    const src=(isCN?PLAT[Math.floor(rnd()*PLAT.length)]:FOREIGN_CH[Math.floor(rnd()*FOREIGN_CH.length)]);
    rows.push({
      name, country:supplierCountry.name, flag:supplierCountry.flag,
      unitPrice, priceUnit:document.getElementById("priceUnit").value,
      duration, qualification:qual, similarProjects:perf,
      region,
      score,
      contact:"+"+(DIAL[supplierCountry.code]||"00")+" "+
        (isCN?"1"+String(3+Math.floor(rnd()*6)):String(1+Math.floor(rnd()*9)))+
        "****"+String(1000+Math.floor(rnd()*9000)).slice(0,4),
      source:src+" / "+cat,
      priceBasis:priceBasis(rnd,state.tab),
      matchedCats:cat
    });
  }
  return rows;
}

/* ---------- 性价比评分：单价(低优)+工期(低优)+资质+业绩+评分+区域就近 ----------
   归一化后加权。权重可按采购策略调整。 */
const TEMPLATES = CFG.TEMPLATES;
const QUAL_SCORE = CFG.QUAL_SCORE;
function computeValue(rows){
  const W=TEMPLATES[state.template]||TEMPLATES["工程版"];
  const prices=rows.map(r=>r.unitPrice), durs=rows.map(r=>r.duration), maxPerf=Math.max(...rows.map(r=>r.similarProjects),1);
  const targetRegion=document.getElementById("region").value||"";
  return rows.map(r=>{
    const pmin=Math.min(...prices),pmax=Math.max(...prices),dmin=Math.min(...durs),dmax=Math.max(...durs);
    const nPrice = pmax===pmin?1:1-(r.unitPrice-pmin)/(pmax-pmin);   // 越低越高
    const nDur   = dmax===dmin?1:1-(r.duration-dmin)/(dmax-dmin);
    const nQual  = (QUAL_SCORE[r.qualification]||55)/100;
    const nPerf  = r.similarProjects/maxPerf;
    const nScore = r.score/100;
    const nRegion= (targetRegion && r.region && (targetRegion.includes(r.region)||r.region.includes(targetRegion.split("/")[0].trim())))?1:0.55;
    const val=100*(W.price*nPrice+W.dur*nDur+W.qual*nQual+W.perf*nPerf+W.score*nScore+W.region*nRegion);
    return {...r, value:Math.round(val*10)/10};
  }).sort((a,b)=>b.value-a.value).map((r,i)=>({...r,rank:i+1}));
}

/* ---------- 渲染 ---------- */
function scoreClass(v){return v>=78?"s-hi":v>=62?"s-md":"s-lo";}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

function render(rows){
  state.lastRows=rows;
  const W=TEMPLATES[state.template]||TEMPLATES["工程版"];
  const el=document.getElementById("result");
  if(!rows.length){el.innerHTML='<div class="empty">暂无结果</div>';return;}
  const n=rows.length;
  const avgPrice=Math.round(rows.reduce((s,r)=>s+r.unitPrice,0)/n);
  const low=rows.reduce((a,b)=>a.unitPrice<b.unitPrice?a:b);
  const best=rows[0];
  const demo = state.mode==="demo";
  let head=`<div class="summary">
    <div class="stat"><div class="n">${n}</div><div class="l">同类匹配供应商</div></div>
    <div class="stat"><div class="n">${avgPrice.toLocaleString()}</div><div class="l">均价(${esc(rows[0].priceUnit||"—")})</div></div>
    <div class="stat"><div class="n" style="color:var(--accent)">${low.unitPrice.toLocaleString()}</div><div class="l">最低单价(${esc(low.priceUnit||"—")})</div></div>
    <div class="stat"><div class="n" style="color:var(--gold)">${best.value}</div><div class="l">最优性价比 · ${esc(best.name)}</div></div>
  </div>
  <div class="toolbar">
    <button class="gold" onclick="exportCSV()">⬇️ 导出 CSV（带 BOM·Excel 直开）</button>
    <button class="ghost" onclick="genCmd()">🌐 生成联网检索指令</button>
    <button class="ghost" onclick="openImport()">📥 回填真实结果</button>
    <button class="ghost" onclick="runSearch()">↻ 重新寻源</button>
    ${demo?'<span class="badge" style="margin-left:auto">🟢 样例数据 · 非真实报价</span>':'<span class="badge" style="margin-left:auto">🌐 真实检索数据 · 已可追溯</span>'}
  </div>`;

  let rowsHtml=rows.map(r=>{
    const rc=r.rank<=3?"r"+r.rank:"rr";
    return `<tr class="${r.rank===1?'best':''}">
      <td><span class="rank ${rc}">${r.rank}</span></td>
      <td><b>${esc(r.name)}</b>${r.rank===1?' <span class="star">🏆性价比推荐</span>':''}</td>
      <td><span class="flag">${r.flag||''}</span> ${esc(r.country)}</td>
      <td>${r.unitPrice.toLocaleString()}<span class="muted"> ${esc(r.priceUnit)}</span></td>
      <td>${r.duration}<span class="muted"> 天</span></td>
      <td><span class="qual q${esc(r.qualification)}">${esc(r.qualification)}</span></td>
      <td>${r.similarProjects}<span class="muted"> 个</span></td>
      <td>${esc(r.region)}</td>
      <td>${r.score}</td>
      <td class="contact">${esc(r.contact)}</td>
      <td class="src"><a href="#" onclick="return traceTip(event,'${esc(r.source)}','${esc(r.priceBasis)}')">🔗 ${esc(r.source)}</a>
        <div class="price-basis">价格依据：${esc(r.priceBasis)}</div></td>
      <td><span class="score-pill ${scoreClass(r.value)}">${r.value}</span></td>
    </tr>`;
  }).join("");

  el.innerHTML=head+`<div class="tbl-scroll"><table>
    <thead><tr>
      <th>排名</th><th>供应商名称</th><th>国别</th><th>综合单价</th><th>工期</th>
      <th>资质等级</th><th>类似业绩</th><th>区域</th><th>评分</th><th>联系方式</th><th>数据来源</th><th>性价比</th>
    </tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <p class="hint">📌 评分模板「${esc(state.template)}」：单价${Math.round(W.price*100)}% + 交期/工期${Math.round(W.dur*100)}% + 资质/认证${Math.round(W.qual*100)}% + 业绩/产能${Math.round(W.perf*100)}% + 平台评分${Math.round(W.score*100)}% + 区域就近${Math.round(W.region*100)}%（组内 min-max 归一化后加权，权重合计 100%；交期只计分、不设一票否决）。点击"数据来源"查看价格依据与出处；第 1 名自动标记为性价比推荐。</p>`;
}

function traceTip(e,src,basis){e.preventDefault();alert("🔎 数据溯源\n\n来源平台/出处：\n"+src+"\n\n价格依据：\n"+basis+"\n\n（原型内溯源为演示字段；联网模式下此处应挂接原始公告/报价单链接与抓取时间戳）");return false;}

/* ---------- 主流程 ---------- */
function runSearch(){
  const el=document.getElementById("result");
  const country=document.getElementById("country").value;
  if(!country){alert("请先显式选择采购/施工国别。\n\n国别不靠 IP 猜测：它直接决定认证、关税与供应商范围。");document.getElementById("country").focus();return;}
  const q=document.getElementById("query").value.trim();
  el.innerHTML='<div class="empty loading">🔄 正在跨招投标/造价/行业平台检索同类供应商并计算性价比…</div>';
  state.query=q||"(未填写，使用默认场景)";
  setTimeout(()=>{
    let raw;
    if(state.mode==="demo"){ raw=genSuppliers(); }
    else {
      // 联网模式但无后端：给出真实感结果并明确提示需回填
      raw=genSuppliers();
      setTimeout(()=>{ if(confirm("联网模式需接入真实检索后端。\n\n点「确定」打开「生成联网检索指令」把任务交给联网 Agent，再回填真实结果；\n点「取消」先看样例效果。")) genCmd(); },100);
      render(computeValue(raw.map(r=>({...r,source:r.source+"（待联网核验）"}))));
      return;
    }
    render(computeValue(raw));
  },420);
}

/* ---------- CSV 导出（带 BOM，Excel 直开） ---------- */
function exportCSV(){
  if(!state.lastRows.length){alert("请先执行寻源");return;}
  const cols=["排名","供应商名称","国别","综合单价","计价单位","工期(天)","资质等级","类似业绩(个)","区域","评分","联系方式","数据来源","价格依据","性价比得分"];
  const lines=[cols.join(",")];
  state.lastRows.forEach(r=>{
    lines.push([r.rank,'"'+r.name+'"','"'+r.country+'"',r.unitPrice,'"'+r.priceUnit+'"',r.duration,'"'+r.qualification+'"',r.similarProjects,'"'+r.region+'"',r.score,'"'+r.contact+'"','"'+r.source+'"','"'+r.priceBasis+'"',r.value].join(","));
  });
  const csv="\uFEFF"+lines.join("\r\n"); // BOM
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  const tabName={material:"物料",profb:"专业分包",labor:"劳务分包"}[state.tab];
  a.download=`供应商寻源比价_${tabName}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();URL.revokeObjectURL(a.href);
}

/* ---------- 联网检索指令生成 ---------- */
function genCmd(){
  const tabName={material:"物料供应商",profb:"专业分包供应商",labor:"劳务分包供应商"}[state.tab];
  const country=document.getElementById("country").value||"CN";
  const cObj=COUNTRIES.find(c=>c.code===country)||COUNTRIES[0];
  const cats=state.tab==="profb"?(state.subCats.size?[...state.subCats].join("、"):PROF_CATS.join("、")):
             state.tab==="labor"?(state.subCats.size?[...state.subCats].join("、"):LABOR_CATS.join("、")):[...state.industries].join("、");
  const cmd=
`【供应商自动寻源任务】
子系统：${tabName}寻源
检索标的/关键词：${state.query}
${state.tab==="profb"?"专业类别（16类范围内）：":state.tab==="labor"?"劳务工种（10类范围内）：":"覆盖行业大类："}${cats}
目标区域：${document.getElementById("region").value}
采购/施工国别：${cObj.name}（ISO ${country}）—— 请检索该国有资质/可供货的源头厂家与分包单位
计价单位：${document.getElementById("priceUnit").value}
评分模板：${state.template}（单价${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).price*100)}% / 交期${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).dur*100)}% / 资质认证${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).qual*100)}% / 业绩产能${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).perf*100)}% / 评分${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).score*100)}% / 区域${Math.round((TEMPLATES[state.template]||TEMPLATES["工程版"]).region*100)}%；交期只计分、不作一票否决）
最低家数：≥${Math.max(3,parseInt(document.getElementById("minCount").value)||5)} 家，须为同类专业/同类规格/同计价单位匹配

【检索数据源（跨平台）】
- 招投标：中国招标投标公共服务平台 / 全国建筑市场监管公共服务平台(四库一平台) / 中国政府采购网 / 当地公共采购平台
- 造价价格：造价通·广材网 / 各省市信息价 / 行业价格指数
- B2B 目录：Europages / Kompass / Alibaba 国际站 / Made-in-China / GlobalSources / 各国商会名录 / Thomasnet（按国别选用）
- 企业工商与资质：企查查/天眼查仅作线索，须回 gsxt（国家企业信用信息公示系统）/ 住建资质库 / 认证机构库（CNCA、NANDO、UL Product iQ、SABER）复核

【每条结果必须输出的字段（JSON 数组）】
name 供应商名称 | country 国别 | unitPrice 综合单价 | priceUnit 计价单位 | duration 交期(天)
| qualification 资质等级(特级/一级/二级/三级/待核验) | certs 认证清单(ISO/CE/RoHS/UL/SASO/MSZ) | similarProjects 类似业绩
| region 区域 | score 综合评分(0-100) | contact 联系方式（含联系人/邮箱/电话，去重后）
| source 数据来源(平台+URL+抓取时间) | priceBasis 价格依据 | moq 起订量 | incoterm/currency（外贸必填）

【硬性要求】
1) 每条结果给出可点击来源链接与抓取时间戳，价格须有报价单/中标公示/信息价出处，做到比价可验证、可追溯；
2) 至少 ${Math.max(3,parseInt(document.getElementById("minCount").value)||5)} 家同类匹配；按统一社会信用代码/企业注册号/电话/官网域名去重，同源只留一条并注明关联主体；
3) 资质与业绩须能在官方库核验，无法核验的标注"未核验"；CE 是符合性声明(DoC)+技术文件，不是一张"证书"；MSZ 为匈牙利国家标准，欧盟市场仍以 CE 为主；
4) 国别由采购方显式指定，禁止以 IP 猜测替代；认证、关税与供应商范围均以该指定国别为准；
5) 贸易版场景须补齐 Incoterms、币种、付款方式（T/T vs L/C）、装运港/目的港、报价有效期、原产地（用于 RCEP/自贸协定优惠税率判断）；
6) 同时输出风险信号：财务异常、被执行/诉讼、经营异常、ESG 负面，无数据写"未获取"；
7) 输出严格为 JSON 数组，便于回填本系统自动重算性价比排名。`;
  document.getElementById("cmdText").textContent=cmd;
  cmdDlg.showModal();
}
function copyCmd(){
  navigator.clipboard.writeText(document.getElementById("cmdText").textContent)
    .then(()=>alert("检索指令已复制，粘贴给联网 Agent 即可"))
    .catch(()=>{ const t=document.getElementById("cmdText").textContent; window.prompt("自动复制失败，请手动全选复制：", t); });
}

/* ---------- 真实结果回填 ---------- */
function openImport(){importDlg.showModal();}
function applyImport(){
  try{
    const data=JSON.parse(document.getElementById("importText").value);
    if(!Array.isArray(data)||!data.length)throw 0;
    const mapped=data.map(r=>({
      name:r.name,country:r.country||"—",flag:(COUNTRIES.find(c=>c.name===(r.country||"")||c.code===(r.country||""))||{flag:"🏳️"}).flag,
      unitPrice:+r.unitPrice||0,priceUnit:r.priceUnit||document.getElementById("priceUnit").value,
      duration:+r.duration||0,qualification:r.qualification||"—",similarProjects:+r.similarProjects||0,
      region:r.region||"—",score:+r.score||0,contact:r.contact||"—",source:r.source||"联网检索",priceBasis:r.priceBasis||"—",matchedCats:r.category||""
    }));
    state.mode="web";updateMode();
    render(computeValue(mapped));
    importDlg.close();
  }catch(e){alert("JSON 解析失败，请检查格式（需为数组，字段见占位示例）。");}
}

/* ---------- 国别 IP 自动识别 ---------- */
function detectCountry(){
  const st=document.getElementById("countryStatus");
  const done=(name,code)=>{st.textContent=`ℹ️ IP 推测：${name||"未知"}${code?"（"+code+"）":""} — 未自动采用，请手动确认`;};
  fetch("https://ipwho.is/?lang=zh-CN")
    .then(r=>r.json())
    .then(d=>{ if(d&&d.success!==false&&d.country_code) done(d.country,d.country_code.toUpperCase());
               else throw 0; })
    .catch(()=>{ // 备用源
      fetch("https://ipapi.co/json/").then(r=>r.json()).then(d=>done(d.country_name,d.country_code))
        .catch(()=>done("未知","")); });
}

/* ---------- UI 构建 ---------- */
function buildTabs(){
  const t=document.getElementById("tabs");
  t.innerHTML=TABS.map(x=>`<div class="tab ${x.id===state.tab?'active':''}" onclick="switchTab('${x.id}')"><span class="ic">${x.ic}</span>${x.label}</div>`).join("");
}
function buildChips(el,items,set,multi=true,onChange=null){
  el.innerHTML=items.map(x=>`<span class="cat ${set.has(x)?'active':''}" data-v="${esc(x)}">${esc(x)}</span>`).join("");
  el.querySelectorAll(".cat").forEach(c=>c.onclick=()=>{
    const v=c.dataset.v;
    if(multi){ set.has(v)?set.delete(v):set.add(v); }
    else { set.clear(); set.add(v); }
    buildChips(el,items,set,multi,onChange);
    if(onChange) onChange([...set]);
  });
}
/* 按品类自动切换评分模板；用户仍可在下拉里手动覆盖 */
const TRADE_CATS = CFG.TRADE_CATS;
function templateForIndustries(list){
  if(list.some(x=>TRADE_CATS.includes(x))) return "贸易版";
  return "制造版";
}
function applyIndustryTemplate(list){
  const t=templateForIndustries(list);
  state.template=t;
  const sel=document.getElementById("template"); if(sel) sel.value=t;
}
function switchTab(id){
  state.tab=id; state.subCats=new Set();
  buildTabs();
  const q=document.getElementById("query"),ql=document.getElementById("qLabel"),ind=document.getElementById("industryCats"),
        sub=document.getElementById("subCats"),subw=document.getElementById("subcatWrap"),subl=document.getElementById("subcatLabel"),
        pu=document.getElementById("priceUnit");
  ind.parentElement.style.display = id==="material"?"flex":"none";
  subw.style.display = id==="material"?"none":"flex";
  if(id==="material"){ql.textContent="输入商品名称 / 上传规格图片（物料寻源）";
    state.template="制造版";document.getElementById("template").value="制造版";
    q.placeholder="例如：Q235B 热轧 H 型钢 400×200 / 变压器 SCB13-1000kVA / 阴极铜板";pu.value="元/吨";
    buildChips(ind,INDUSTRIES,state.industries,true,applyIndustryTemplate);
    applyIndustryTemplate([...state.industries]);}
  else if(id==="profb"){ql.textContent="输入专业分包工程描述（专业分包寻源）";
    state.template="工程版";document.getElementById("template").value="工程版";
    q.placeholder="例如：地铁车站幕墙 engineering / 高层机电安装 / 尾矿库坝体掘进";subl.textContent="专业分包类别（16 类）";
    buildChips(sub,PROF_CATS,state.subCats);pu.value="元/㎡";}
  else{ql.textContent="输入劳务工种/施工内容（劳务分包寻源）";
    state.template="工程版";document.getElementById("template").value="工程版";
    q.placeholder="例如：高层钢筋绑扎劳务 / 地下室混凝土浇筑 / 外架搭拆";subl.textContent="劳务分包工种（10 类）";
    buildChips(sub,LABOR_CATS,state.subCats);pu.value="元/㎡";}
  document.getElementById("result").innerHTML='<div class="empty">填写标的后点击「🔎 自动寻源比价」，系统将跨平台检索同类供应商并给出 ≥3 家比价与性价比推荐。</div>';
}
function updateMode(){
  document.querySelectorAll("#modeSwitch span").forEach(s=>s.classList.toggle("on",s.dataset.m===state.mode));
  document.getElementById("modeNote").textContent = state.mode==="demo"
    ? "样例模式：用真实感供应商库完整演示「≥3 家同类匹配 → 性价比评分 → 可追溯 → CSV」全流程，接口已预留给真实数据源。"
    : "联网模式：真实报价需接入检索后端。点「生成联网检索指令」→交给联网 Agent→回填 JSON 即得可追溯真实比价。";
}

/* ---------- 初始化 ---------- */
function initCountrySelect(){
  const sel=document.getElementById("country");
  sel.innerHTML='<option value="">请选择国别（必选）</option>'+COUNTRIES.map(c=>`<option value="${c.code}">${c.flag} ${c.name}</option>`).join("");
  sel.value="";
  sel.onchange=()=>{document.getElementById("countryStatus").textContent="✅ 已显式指定国别："+sel.selectedOptions[0].textContent+" — 寻源将检索该国资源";};
}
const cmdDlg=document.getElementById("cmdDlg"),importDlg=document.getElementById("importDlg");
window.genCmd=genCmd;window.copyCmd=copyCmd;window.openImport=openImport;window.applyImport=applyImport;
window.runSearch=runSearch;window.exportCSV=exportCSV;window.switchTab=switchTab;window.traceTip=traceTip;window.updateMode=updateMode;

buildTabs();initCountrySelect();switchTab("material");detectCountry();
document.querySelectorAll("#modeSwitch span").forEach(s=>s.onclick=()=>{state.mode=s.dataset.m;updateMode();});
document.getElementById("img").onchange=e=>{if(e.target.files[0]){document.getElementById("query").value="[图片识别] "+e.target.files[0].name;alert("原型内为占位图片入口：图片寻源需接入 OCR/图像检索模型识别规格后再检索。已把文件名填入关键词，可直接点寻源演示。");}};
