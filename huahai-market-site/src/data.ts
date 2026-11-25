/**
 * 产销溯源演示数据。全部为虚构示例，不读取物联网平台、爱买买账户、库存、价格或订单。
 * 只包含物联网平台当前已有的数据类型：组织/基地/塘、批次与来源链、饲料批号与投喂、
 * 死亡与起捕、水质监测与预警、机构检测、照片、数据修订。用药、施肥、称重生长曲线本期不展示。
 */

export type Source = 'sensor' | 'farmer' | 'lab' | 'system';
export type Metric = 'do' | 'temp' | 'ph' | 'nh3';
export type Water = 'marine' | 'fresh';
export type EventKind = 'STOCK' | 'SUPPLEMENT' | 'TRANSFER' | 'SPLIT' | 'FEED' | 'ALERT' | 'INSPECTION' | 'PHOTO' | 'MORTALITY' | 'HARVEST';

export interface Company { id: string; name: string; short: string; founded: string; intro: string }
export interface Base { id: string; name: string; region: string; area: string; water: Water; manager: string; coords: string; intro: string; sensors: number }
export interface Pond { id: string; baseId: string; name: string; areaMu: number; depthM: number; kind: string; species: string; status: 'growing' | 'harvested' | 'idle'; x: number; y: number; w: number; h: number; currentBatch?: string }
export interface LineageNode { pondId: string; from: string; to: string; stage: string; qty: string; note: string }
export interface TimelineEvent { date: string; kind: EventKind; title: string; detail: string; source: Source }
export interface FeedUse { stage: string; product: string; brand: string; lot: string; protein: string; kg: number; from: string; to: string }
export interface AlertRecord { date: string; metric: Metric; level: '提醒' | '预警'; value: string; action: string; recoveredIn: string }
export interface LabItem { name: string; result: string; limit: string; pass: boolean }
export interface LabReport { agency: string; reportNo: string; sampled: string; issued: string; sample: string; category: string; items: LabItem[] }
export interface Photo { date: string; caption: string; scene: 'pond' | 'seed' | 'feed' | 'harvest' | 'lab' | 'pack'; source: Source }
export interface Revision { date: string; field: string; before: string; after: string; by: string; reason: string }
export interface Batch {
  code: string; productId: string; species: string; latin: string; baseId: string; pondId: string;
  stockDate: string; harvestDate: string; status: '已起捕' | '养殖中';
  seed: { source: string; size: string; count: number; quarantine: string };
  lineage: LineageNode[]; events: TimelineEvent[]; feeds: FeedUse[];
  survival: number; mortalityNote: string;
  harvest: { qtyKg: number; spec: string; method: string };
  alerts: AlertRecord[]; labs: LabReport[]; photos: Photo[];
  provenance: { sensorSamples: number; farmerRecords: number; labDocs: number; revisions: Revision[]; fingerprint: string };
  sensors: number;
}
export interface Product {
  id: string; name: string; sub: string; category: '鱼类' | '虾类'; price: number; unit: string; spec: string;
  stock: number; sold: number; tags: string[]; art: ArtKind; batchCode: string;
  b2b: { wholesale: number; inPondKg: number; nextHarvest: string; moq: string; weekly: number[] };
}
export type ArtKind = 'pompano' | 'shrimp' | 'tilapia' | 'bass' | 'grouper' | 'seabream';

export const company: Company = {
  id: 'huahai', name: '华海农科（演示）', short: '华海农科', founded: '2016',
  intro: '以物联网监测、养殖记录和机构检测为基础，为每一批水产建立可追溯的生产档案。',
};

export const bases: readonly Base[] = [
  { id: 'yj', name: '阳江海陵岛示范基地', region: '广东 · 阳江', area: '186 亩', water: 'marine', manager: '陈场长（演示）', coords: '21.6°N 111.9°E', intro: '近海高位池与标粗池组合，主养金鲳鱼、南美白对虾。', sensors: 46 },
  { id: 'mm', name: '茂名电白生态基地', region: '广东 · 茂名', area: '240 亩', water: 'fresh', manager: '李场长（演示）', coords: '21.5°N 111.0°E', intro: '淡水池塘循环水养殖，主养罗非鱼、加州鲈。', sensors: 38 },
  { id: 'zj', name: '湛江东海岛深水基地', region: '广东 · 湛江', area: '152 亩', water: 'marine', manager: '黄场长（演示）', coords: '21.0°N 110.5°E', intro: '海水工厂化与池塘结合，主养珍珠龙胆石斑、黄鳍鲷。', sensors: 44 },
];

export const ponds: readonly Pond[] = [
  { id: 'YJ-01', baseId: 'yj', name: '1号标粗池', areaMu: 4, depthM: 1.8, kind: '标粗池', species: '金鲳鱼苗', status: 'growing', x: 4, y: 6, w: 26, h: 36, currentBatch: 'HH-YJ-2610-01' },
  { id: 'YJ-02', baseId: 'yj', name: '2号高位池', areaMu: 12, depthM: 2.4, kind: '高位池', species: '金鲳鱼', status: 'harvested', x: 34, y: 6, w: 30, h: 40 },
  { id: 'YJ-03', baseId: 'yj', name: '3号虾塘', areaMu: 10, depthM: 1.6, kind: '高位池', species: '南美白对虾', status: 'harvested', x: 68, y: 6, w: 28, h: 40 },
  { id: 'YJ-04', baseId: 'yj', name: '4号高位池', areaMu: 12, depthM: 2.4, kind: '高位池', species: '金鲳鱼', status: 'growing', x: 4, y: 52, w: 44, h: 42, currentBatch: 'HH-YJ-2608-04' },
  { id: 'MM-01', baseId: 'mm', name: '1号鱼塘', areaMu: 15, depthM: 2.2, kind: '土塘', species: '罗非鱼', status: 'harvested', x: 4, y: 6, w: 44, h: 40 },
  { id: 'MM-02', baseId: 'mm', name: '2号鱼塘', areaMu: 15, depthM: 2.2, kind: '土塘', species: '罗非鱼', status: 'growing', x: 52, y: 6, w: 44, h: 40, currentBatch: 'HH-MM-2604-01B' },
  { id: 'MM-03', baseId: 'mm', name: '3号鲈鱼塘', areaMu: 18, depthM: 2.5, kind: '循环水池塘', species: '加州鲈', status: 'harvested', x: 4, y: 52, w: 92, h: 42 },
  { id: 'ZJ-01', baseId: 'zj', name: 'A1 工厂化车间', areaMu: 6, depthM: 1.5, kind: '工厂化循环水', species: '珍珠龙胆石斑', status: 'harvested', x: 4, y: 6, w: 40, h: 40 },
  { id: 'ZJ-02', baseId: 'zj', name: 'B2 海水塘', areaMu: 20, depthM: 2.6, kind: '海水土塘', species: '黄鳍鲷', status: 'harvested', x: 48, y: 6, w: 48, h: 40 },
  { id: 'ZJ-03', baseId: 'zj', name: 'B3 海水塘', areaMu: 20, depthM: 2.6, kind: '海水土塘', species: '黄鳍鲷', status: 'growing', x: 4, y: 52, w: 92, h: 42, currentBatch: 'HH-ZJ-2607-03' },
];

const S = (n: number) => n.toLocaleString('zh-CN');

export const batches: readonly Batch[] = [
  {
    code: 'HH-YJ-2605-02', productId: 'pompano', species: '金鲳鱼', latin: 'Trachinotus ovatus', baseId: 'yj', pondId: 'YJ-02',
    stockDate: '2026-05-08', harvestDate: '2026-11-18', status: '已起捕',
    seed: { source: '阳江闸坡持证苗场（演示）', size: '3–4 cm', count: 48000, quarantine: '水产苗种产地检疫合格证 YJ-2605-117（演示）' },
    lineage: [
      { pondId: 'YJ-01', from: '2026-05-08', to: '2026-06-12', stage: '标粗', qty: `${S(48000)} 尾放入`, note: '小水体集中标粗，便于驯食和观察' },
      { pondId: 'YJ-02', from: '2026-06-12', to: '2026-11-18', stage: '养成', qty: `${S(44600)} 尾转入`, note: '规格达 8 cm 后整体转入高位池' },
    ],
    events: [
      { date: '2026-05-08', kind: 'STOCK', title: '放苗入 1 号标粗池', detail: '48,000 尾，规格 3–4 cm，附检疫合格证', source: 'farmer' },
      { date: '2026-05-08', kind: 'PHOTO', title: '苗种到场拍照', detail: '苗袋编号与检疫证同框拍摄', source: 'farmer' },
      { date: '2026-05-20', kind: 'FEED', title: '开口料转标粗料', detail: '饲料批号 HF-0D-260511，日投喂 4 次', source: 'farmer' },
      { date: '2026-06-12', kind: 'TRANSFER', title: '转塘至 2 号高位池', detail: '转出 44,600 尾，标粗成活率 92.9%', source: 'farmer' },
      { date: '2026-07-21', kind: 'ALERT', title: '凌晨溶氧偏低提醒', detail: '04:10 溶氧 4.6 mg/L，自动提醒后开启增氧，52 分钟恢复', source: 'sensor' },
      { date: '2026-08-15', kind: 'INSPECTION', title: '养殖用水送检', detail: '水样送第三方检测，结果见检测报告', source: 'lab' },
      { date: '2026-09-02', kind: 'MORTALITY', title: '台风后死亡记录', detail: '台风过境后巡塘捞出 310 尾，已拍照登记', source: 'farmer' },
      { date: '2026-10-28', kind: 'INSPECTION', title: '成鱼抽样送检', detail: '随机抽取 6 尾送检药残与微生物项目', source: 'lab' },
      { date: '2026-11-18', kind: 'HARVEST', title: '起捕上市', detail: '起捕 22,860 kg，规格 500–600 g/尾', source: 'farmer' },
    ],
    feeds: [
      { stage: '标粗期', product: '海水鱼开口配合饲料 0#', brand: '海粤饲料（演示）', lot: 'HF-0D-260502', protein: '≥ 48%', kg: 860, from: '2026-05-08', to: '2026-05-31' },
      { stage: '标粗期', product: '海水鱼配合饲料 1#', brand: '海粤饲料（演示）', lot: 'HF-1D-260511', protein: '≥ 45%', kg: 2140, from: '2026-05-20', to: '2026-06-30' },
      { stage: '养成前期', product: '金鲳鱼膨化配合饲料 3#', brand: '海粤饲料（演示）', lot: 'HF-3P-260618', protein: '≥ 42%', kg: 13800, from: '2026-06-12', to: '2026-08-31' },
      { stage: '养成后期', product: '金鲳鱼膨化配合饲料 5#', brand: '海粤饲料（演示）', lot: 'HF-5P-260826', protein: '≥ 40%', kg: 19400, from: '2026-09-01', to: '2026-11-15' },
    ],
    survival: 86.4, mortalityNote: '全程登记死亡 6,082 尾，其中台风后集中死亡 310 尾，均有巡塘照片',
    harvest: { qtyKg: 22860, spec: '500–600 g/尾', method: '拉网起捕，冰水预冷后装箱' },
    alerts: [
      { date: '2026-07-21', metric: 'do', level: '提醒', value: '4.6 mg/L', action: '开启 2 台增氧机', recoveredIn: '52 分钟' },
      { date: '2026-08-09', metric: 'temp', level: '提醒', value: '32.8 ℃', action: '加注新水，减料 30%', recoveredIn: '6 小时' },
    ],
    labs: [
      {
        agency: '粤西水产品质量检测中心（演示）', reportNo: 'YXJC-2610-0428', sampled: '2026-10-28', issued: '2026-11-03', sample: '金鲳鱼肌肉 6 尾混样', category: '渔药残留与微生物',
        items: [
          { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
          { name: '孔雀石绿（含隐色）', result: '未检出', limit: '不得检出', pass: true },
          { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
          { name: '恩诺沙星 + 环丙沙星', result: '未检出', limit: '≤ 100 μg/kg', pass: true },
          { name: '磺胺类（总量）', result: '未检出', limit: '≤ 100 μg/kg', pass: true },
          { name: '铅（以 Pb 计）', result: '0.03 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
          { name: '镉（以 Cd 计）', result: '< 0.01 mg/kg', limit: '≤ 0.1 mg/kg', pass: true },
          { name: '副溶血性弧菌', result: '未检出', limit: '不得检出', pass: true },
        ],
      },
      {
        agency: '粤西水产品质量检测中心（演示）', reportNo: 'YXJC-2608-0815', sampled: '2026-08-15', issued: '2026-08-19', sample: '2 号高位池养殖用水', category: '养殖用水',
        items: [
          { name: '溶解氧', result: '6.8 mg/L', limit: '≥ 5 mg/L', pass: true },
          { name: 'pH', result: '8.1', limit: '7.0–8.5', pass: true },
          { name: '无机氮', result: '0.21 mg/L', limit: '≤ 0.5 mg/L', pass: true },
          { name: '活性磷酸盐', result: '0.018 mg/L', limit: '≤ 0.03 mg/L', pass: true },
        ],
      },
    ],
    photos: [
      { date: '2026-05-08', caption: '苗种到场与检疫证同框', scene: 'seed', source: 'farmer' },
      { date: '2026-06-12', caption: '转塘前抽样量体长', scene: 'pond', source: 'farmer' },
      { date: '2026-07-03', caption: '饲料入库批号标签', scene: 'feed', source: 'farmer' },
      { date: '2026-10-28', caption: '成鱼抽样封样', scene: 'lab', source: 'lab' },
      { date: '2026-11-18', caption: '拉网起捕现场', scene: 'harvest', source: 'farmer' },
      { date: '2026-11-18', caption: '冰水预冷与装箱', scene: 'pack', source: 'farmer' },
    ],
    provenance: {
      sensorSamples: 1_486_080, farmerRecords: 412, labDocs: 2,
      revisions: [
        { date: '2026-06-13', field: '转塘数量', before: '44,000 尾', after: '44,600 尾', by: '陈场长（演示）', reason: '复点后更正，附点数照片' },
        { date: '2026-09-03', field: '死亡数量', before: '280 尾', after: '310 尾', by: '巡塘员（演示）', reason: '次日补捞登记' },
      ],
      fingerprint: '8f3c 91ad 07e2 5b64 c1d0 3e9a 4f72 bb18',
    },
    sensors: 8,
  },
  {
    code: 'HH-YJ-2607-03', productId: 'shrimp', species: '南美白对虾', latin: 'Litopenaeus vannamei', baseId: 'yj', pondId: 'YJ-03',
    stockDate: '2026-07-16', harvestDate: '2026-11-12', status: '已起捕',
    seed: { source: '湛江 SPF 虾苗场（演示）', size: 'P10', count: 1200000, quarantine: '虾苗检疫合格证 ZJ-2607-063（演示）' },
    lineage: [{ pondId: 'YJ-03', from: '2026-07-16', to: '2026-11-12', stage: '一次放养养成', qty: '120 万尾放入', note: '高位池一次放苗到底，不转塘' }],
    events: [
      { date: '2026-07-16', kind: 'STOCK', title: '放苗入 3 号虾塘', detail: 'P10 虾苗 120 万尾，附检疫证', source: 'farmer' },
      { date: '2026-08-02', kind: 'PHOTO', title: '虾苗生长抽查', detail: '网箱抽样拍照，平均体长约 4 cm', source: 'farmer' },
      { date: '2026-08-24', kind: 'ALERT', title: '氨氮升高提醒', detail: '氨氮 0.62 mg/L，加大换水后 1 天恢复', source: 'sensor' },
      { date: '2026-09-10', kind: 'FEED', title: '换用中期虾料', detail: '饲料批号 SR-2P-260905', source: 'farmer' },
      { date: '2026-10-30', kind: 'INSPECTION', title: '成虾抽样送检', detail: '送检渔药残留与重金属项目', source: 'lab' },
      { date: '2026-11-12', kind: 'HARVEST', title: '起捕上市', detail: '起捕 12,480 kg，规格 40–50 只/kg', source: 'farmer' },
    ],
    feeds: [
      { stage: '前期', product: '对虾配合饲料 0#', brand: '海粤饲料（演示）', lot: 'SR-0P-260710', protein: '≥ 42%', kg: 1300, from: '2026-07-16', to: '2026-08-15' },
      { stage: '中期', product: '对虾配合饲料 2#', brand: '海粤饲料（演示）', lot: 'SR-2P-260905', protein: '≥ 40%', kg: 7600, from: '2026-08-16', to: '2026-10-05' },
      { stage: '后期', product: '对虾配合饲料 3#', brand: '海粤饲料（演示）', lot: 'SR-3P-261002', protein: '≥ 38%', kg: 9200, from: '2026-10-06', to: '2026-11-10' },
    ],
    survival: 71.2, mortalityNote: '按每日底网抽查估算存活，月度汇总登记',
    harvest: { qtyKg: 12480, spec: '40–50 只/kg', method: '排水起捕，碎冰保鲜' },
    alerts: [{ date: '2026-08-24', metric: 'nh3', level: '提醒', value: '0.62 mg/L', action: '换水 20%，减料一餐', recoveredIn: '1 天' }],
    labs: [{
      agency: '粤西水产品质量检测中心（演示）', reportNo: 'YXJC-2610-0530', sampled: '2026-10-30', issued: '2026-11-04', sample: '南美白对虾 1 kg 混样', category: '渔药残留与重金属',
      items: [
        { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
        { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
        { name: '恩诺沙星 + 环丙沙星', result: '未检出', limit: '≤ 100 μg/kg', pass: true },
        { name: '镉（以 Cd 计）', result: '0.04 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
        { name: '无机砷', result: '< 0.05 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
      ],
    }],
    photos: [
      { date: '2026-07-16', caption: '虾苗点数与检疫证', scene: 'seed', source: 'farmer' },
      { date: '2026-08-02', caption: '网箱抽样观察', scene: 'pond', source: 'farmer' },
      { date: '2026-09-10', caption: '中期虾料批号', scene: 'feed', source: 'farmer' },
      { date: '2026-11-12', caption: '排水起捕', scene: 'harvest', source: 'farmer' },
    ],
    provenance: { sensorSamples: 984_320, farmerRecords: 268, labDocs: 1, revisions: [{ date: '2026-08-25', field: '投喂量', before: '62 kg', after: '48 kg', by: '技术员（演示）', reason: '氨氮提醒后减料，补录实际投喂' }], fingerprint: '27b0 5ce1 9a83 f402 6d1e 88c7 0b5a 3f96' },
    sensors: 6,
  },
  {
    code: 'HH-MM-2604-01', productId: 'tilapia', species: '罗非鱼', latin: 'Oreochromis niloticus', baseId: 'mm', pondId: 'MM-01',
    stockDate: '2026-04-10', harvestDate: '2026-11-08', status: '已起捕',
    seed: { source: '茂名良种场吉富品系（演示）', size: '5–6 cm', count: 52000, quarantine: '苗种检疫合格证 MM-2604-022（演示）' },
    lineage: [
      { pondId: 'MM-01', from: '2026-04-10', to: '2026-07-05', stage: '养成前期', qty: `${S(52000)} 尾放入`, note: '密度升高后分塘' },
      { pondId: 'MM-02', from: '2026-07-05', to: '养殖中', stage: '分塘', qty: `${S(18000)} 尾分出`, note: '分出部分在 2 号塘继续养殖，另建子批次 HH-MM-2604-01B' },
      { pondId: 'MM-01', from: '2026-07-05', to: '2026-11-08', stage: '养成后期', qty: `${S(31400)} 尾留塘`, note: '本商品来自留塘部分' },
    ],
    events: [
      { date: '2026-04-10', kind: 'STOCK', title: '放苗入 1 号鱼塘', detail: '吉富罗非鱼 52,000 尾，规格 5–6 cm', source: 'farmer' },
      { date: '2026-05-18', kind: 'FEED', title: '换用 2 号料', detail: '饲料批号 TF-2P-260512', source: 'farmer' },
      { date: '2026-07-05', kind: 'SPLIT', title: '分塘', detail: '分出 18,000 尾至 2 号鱼塘，留塘 31,400 尾', source: 'farmer' },
      { date: '2026-08-11', kind: 'ALERT', title: '高温天水温预警', detail: '午后水温 34.2 ℃，加注深井水并减料', source: 'sensor' },
      { date: '2026-10-20', kind: 'INSPECTION', title: '成鱼抽样送检', detail: '渔药残留与重金属', source: 'lab' },
      { date: '2026-11-08', kind: 'HARVEST', title: '起捕上市', detail: '起捕 21,350 kg，规格 600–800 g/尾', source: 'farmer' },
    ],
    feeds: [
      { stage: '前期', product: '罗非鱼膨化饲料 1#', brand: '粤农饲料（演示）', lot: 'TF-1P-260405', protein: '≥ 34%', kg: 6200, from: '2026-04-10', to: '2026-05-17' },
      { stage: '中期', product: '罗非鱼膨化饲料 2#', brand: '粤农饲料（演示）', lot: 'TF-2P-260512', protein: '≥ 30%', kg: 12800, from: '2026-05-18', to: '2026-08-20' },
      { stage: '后期', product: '罗非鱼膨化饲料 3#', brand: '粤农饲料（演示）', lot: 'TF-3P-260818', protein: '≥ 28%', kg: 14600, from: '2026-08-21', to: '2026-11-05' },
    ],
    survival: 90.8, mortalityNote: '分塘后留塘部分死亡 2,870 尾，按日登记',
    harvest: { qtyKg: 21350, spec: '600–800 g/尾', method: '拉网起捕，活鱼车运输' },
    alerts: [{ date: '2026-08-11', metric: 'temp', level: '预警', value: '34.2 ℃', action: '加注深井水，减料 30%', recoveredIn: '5 小时' }],
    labs: [{
      agency: '茂名市农产品质量检测站（演示）', reportNo: 'MMZJ-2610-1020', sampled: '2026-10-20', issued: '2026-10-26', sample: '罗非鱼肌肉 5 尾混样', category: '渔药残留与重金属',
      items: [
        { name: '孔雀石绿（含隐色）', result: '未检出', limit: '不得检出', pass: true },
        { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
        { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
        { name: '地西泮', result: '未检出', limit: '不得检出', pass: true },
        { name: '铅（以 Pb 计）', result: '0.05 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
        { name: '甲基汞', result: '< 0.01 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
      ],
    }],
    photos: [
      { date: '2026-04-10', caption: '鱼苗到塘', scene: 'seed', source: 'farmer' },
      { date: '2026-07-05', caption: '分塘拉网点数', scene: 'pond', source: 'farmer' },
      { date: '2026-08-21', caption: '后期饲料批号', scene: 'feed', source: 'farmer' },
      { date: '2026-11-08', caption: '起捕装车', scene: 'harvest', source: 'farmer' },
    ],
    provenance: { sensorSamples: 1_270_400, farmerRecords: 356, labDocs: 1, revisions: [], fingerprint: 'c4e1 0a77 5d92 13bf e806 4a3c 92d5 7e01' },
    sensors: 6,
  },
  {
    code: 'HH-MM-2603-03', productId: 'bass', species: '加州鲈', latin: 'Micropterus salmoides', baseId: 'mm', pondId: 'MM-03',
    stockDate: '2026-03-22', harvestDate: '2026-11-15', status: '已起捕',
    seed: { source: '佛山加州鲈良种场（演示）', size: '4–5 cm', count: 36000, quarantine: '苗种检疫合格证 FS-2603-208（演示）' },
    lineage: [{ pondId: 'MM-03', from: '2026-03-22', to: '2026-11-15', stage: '循环水养成', qty: `${S(36000)} 尾放入`, note: '循环水池塘，一次放养' }],
    events: [
      { date: '2026-03-22', kind: 'STOCK', title: '放苗入 3 号鲈鱼塘', detail: '加州鲈 36,000 尾，已完成配合饲料驯化', source: 'farmer' },
      { date: '2026-04-15', kind: 'SUPPLEMENT', title: '补苗', detail: '补放 1,500 尾同批次苗种', source: 'farmer' },
      { date: '2026-06-28', kind: 'ALERT', title: '暴雨后 pH 下降提醒', detail: 'pH 6.4，泼洒生石灰调节后恢复', source: 'sensor' },
      { date: '2026-09-18', kind: 'INSPECTION', title: '养殖用水送检', detail: '循环水系统出水检测', source: 'lab' },
      { date: '2026-11-03', kind: 'INSPECTION', title: '成鱼抽样送检', detail: '渔药残留项目', source: 'lab' },
      { date: '2026-11-15', kind: 'HARVEST', title: '起捕上市', detail: '起捕 15,620 kg，规格 450–550 g/尾', source: 'farmer' },
    ],
    feeds: [
      { stage: '前期', product: '加州鲈配合饲料 2#', brand: '粤农饲料（演示）', lot: 'BF-2P-260318', protein: '≥ 48%', kg: 3800, from: '2026-03-22', to: '2026-05-31' },
      { stage: '中期', product: '加州鲈配合饲料 4#', brand: '粤农饲料（演示）', lot: 'BF-4P-260601', protein: '≥ 46%', kg: 9600, from: '2026-06-01', to: '2026-08-31' },
      { stage: '后期', product: '加州鲈配合饲料 6#', brand: '粤农饲料（演示）', lot: 'BF-6P-260902', protein: '≥ 45%', kg: 8700, from: '2026-09-01', to: '2026-11-12' },
    ],
    survival: 88.1, mortalityNote: '全程按日登记死亡，累计 4,470 尾',
    harvest: { qtyKg: 15620, spec: '450–550 g/尾', method: '拉网起捕，充氧活鱼运输' },
    alerts: [{ date: '2026-06-28', metric: 'ph', level: '提醒', value: 'pH 6.4', action: '泼洒生石灰调节', recoveredIn: '8 小时' }],
    labs: [{
      agency: '茂名市农产品质量检测站（演示）', reportNo: 'MMZJ-2611-1103', sampled: '2026-11-03', issued: '2026-11-08', sample: '加州鲈肌肉 5 尾混样', category: '渔药残留',
      items: [
        { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
        { name: '孔雀石绿（含隐色）', result: '未检出', limit: '不得检出', pass: true },
        { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
        { name: '恩诺沙星 + 环丙沙星', result: '12 μg/kg', limit: '≤ 100 μg/kg', pass: true },
        { name: '甲砜霉素', result: '未检出', limit: '≤ 50 μg/kg', pass: true },
      ],
    }],
    photos: [
      { date: '2026-03-22', caption: '驯化苗种到塘', scene: 'seed', source: 'farmer' },
      { date: '2026-06-01', caption: '中期饲料批号', scene: 'feed', source: 'farmer' },
      { date: '2026-11-03', caption: '成鱼抽样', scene: 'lab', source: 'lab' },
      { date: '2026-11-15', caption: '起捕分拣', scene: 'harvest', source: 'farmer' },
    ],
    provenance: { sensorSamples: 1_652_160, farmerRecords: 381, labDocs: 2, revisions: [{ date: '2026-04-16', field: '放苗数量', before: '36,000 尾', after: '36,000 尾 + 补苗 1,500 尾', by: '李场长（演示）', reason: '补苗另行登记，不改原放苗记录' }], fingerprint: '5a0e d317 b28c 64f1 09ad e7c2 3318 bf4e' },
    sensors: 8,
  },
  {
    code: 'HH-ZJ-2601-01', productId: 'grouper', species: '珍珠龙胆石斑', latin: 'Epinephelus fuscoguttatus × E. lanceolatus', baseId: 'zj', pondId: 'ZJ-01',
    stockDate: '2026-01-15', harvestDate: '2026-11-10', status: '已起捕',
    seed: { source: '海南石斑良种场（演示）', size: '8–10 cm', count: 15000, quarantine: '苗种检疫合格证 HN-2601-091（演示）' },
    lineage: [{ pondId: 'ZJ-01', from: '2026-01-15', to: '2026-11-10', stage: '工厂化养成', qty: `${S(15000)} 尾放入`, note: '室内循环水车间，恒温养殖' }],
    events: [
      { date: '2026-01-15', kind: 'STOCK', title: '放苗入 A1 车间', detail: '珍珠龙胆石斑 15,000 尾', source: 'farmer' },
      { date: '2026-03-02', kind: 'FEED', title: '换用中期料', detail: '饲料批号 GF-3P-260226', source: 'farmer' },
      { date: '2026-05-14', kind: 'ALERT', title: '循环水溶氧下降提醒', detail: '水泵检修期间溶氧 5.2 mg/L，启用备用纯氧', source: 'sensor' },
      { date: '2026-09-25', kind: 'INSPECTION', title: '成鱼抽样送检', detail: '渔药残留与微生物', source: 'lab' },
      { date: '2026-11-10', kind: 'HARVEST', title: '起捕上市', detail: '起捕 9,620 kg，规格 0.8–1.0 kg/尾', source: 'farmer' },
    ],
    feeds: [
      { stage: '前期', product: '石斑鱼配合饲料 2#', brand: '海粤饲料（演示）', lot: 'GF-2P-260110', protein: '≥ 50%', kg: 2400, from: '2026-01-15', to: '2026-03-01' },
      { stage: '中期', product: '石斑鱼配合饲料 3#', brand: '海粤饲料（演示）', lot: 'GF-3P-260226', protein: '≥ 48%', kg: 6200, from: '2026-03-02', to: '2026-07-15' },
      { stage: '后期', product: '石斑鱼配合饲料 5#', brand: '海粤饲料（演示）', lot: 'GF-5P-260712', protein: '≥ 46%', kg: 5900, from: '2026-07-16', to: '2026-11-08' },
    ],
    survival: 82.5, mortalityNote: '车间每日巡检登记，累计死亡 2,625 尾',
    harvest: { qtyKg: 9620, spec: '0.8–1.0 kg/尾', method: '车间排水捞捕，充氧活鱼箱运输' },
    alerts: [{ date: '2026-05-14', metric: 'do', level: '提醒', value: '5.2 mg/L', action: '启用备用纯氧', recoveredIn: '18 分钟' }],
    labs: [{
      agency: '湛江海洋产品检测中心（演示）', reportNo: 'ZJHY-2609-0925', sampled: '2026-09-25', issued: '2026-10-01', sample: '石斑鱼肌肉 3 尾混样', category: '渔药残留与微生物',
      items: [
        { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
        { name: '孔雀石绿（含隐色）', result: '未检出', limit: '不得检出', pass: true },
        { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
        { name: '土霉素/四环素/金霉素（总量）', result: '未检出', limit: '≤ 200 μg/kg', pass: true },
        { name: '副溶血性弧菌', result: '未检出', limit: '不得检出', pass: true },
      ],
    }],
    photos: [
      { date: '2026-01-15', caption: '车间放苗', scene: 'seed', source: 'farmer' },
      { date: '2026-05-14', caption: '备用纯氧系统', scene: 'pond', source: 'farmer' },
      { date: '2026-09-25', caption: '抽样封样', scene: 'lab', source: 'lab' },
      { date: '2026-11-10', caption: '活鱼箱装运', scene: 'pack', source: 'farmer' },
    ],
    provenance: { sensorSamples: 2_096_640, farmerRecords: 498, labDocs: 1, revisions: [], fingerprint: 'e9d2 4b06 71fc 2a8e 50b3 c9d4 16e7 a03f' },
    sensors: 10,
  },
  {
    code: 'HH-ZJ-2604-02', productId: 'seabream', species: '黄鳍鲷', latin: 'Acanthopagrus latus', baseId: 'zj', pondId: 'ZJ-02',
    stockDate: '2026-04-02', harvestDate: '2026-11-20', status: '已起捕',
    seed: { source: '湛江本地鲷鱼苗场（演示）', size: '3–4 cm', count: 40000, quarantine: '苗种检疫合格证 ZJ-2604-015（演示）' },
    lineage: [{ pondId: 'ZJ-02', from: '2026-04-02', to: '2026-11-20', stage: '海水塘养成', qty: `${S(40000)} 尾放入`, note: '纳潮换水海水土塘' }],
    events: [
      { date: '2026-04-02', kind: 'STOCK', title: '放苗入 B2 海水塘', detail: '黄鳍鲷 40,000 尾', source: 'farmer' },
      { date: '2026-06-06', kind: 'PHOTO', title: '中期抽样拍照', detail: '抽样 30 尾拍照记录', source: 'farmer' },
      { date: '2026-07-30', kind: 'ALERT', title: '盐度骤降后溶氧提醒', detail: '强降雨后底层溶氧 4.8 mg/L，开增氧机', source: 'sensor' },
      { date: '2026-11-06', kind: 'INSPECTION', title: '成鱼抽样送检', detail: '渔药残留与重金属', source: 'lab' },
      { date: '2026-11-20', kind: 'HARVEST', title: '起捕上市', detail: '起捕 11,280 kg，规格 350–450 g/尾', source: 'farmer' },
    ],
    feeds: [
      { stage: '前期', product: '海水鱼配合饲料 1#', brand: '海粤饲料（演示）', lot: 'HF-1D-260328', protein: '≥ 45%', kg: 1900, from: '2026-04-02', to: '2026-05-20' },
      { stage: '中期', product: '鲷科鱼膨化饲料 3#', brand: '海粤饲料（演示）', lot: 'SB-3P-260518', protein: '≥ 42%', kg: 7400, from: '2026-05-21', to: '2026-08-31' },
      { stage: '后期', product: '鲷科鱼膨化饲料 4#', brand: '海粤饲料（演示）', lot: 'SB-4P-260829', protein: '≥ 40%', kg: 9100, from: '2026-09-01', to: '2026-11-17' },
    ],
    survival: 84.7, mortalityNote: '累计登记死亡 6,120 尾，强降雨后 3 天内集中 640 尾',
    harvest: { qtyKg: 11280, spec: '350–450 g/尾', method: '拉网起捕，冰鲜处理' },
    alerts: [{ date: '2026-07-30', metric: 'do', level: '预警', value: '4.8 mg/L', action: '开启 4 台增氧机，暂停投喂', recoveredIn: '2.5 小时' }],
    labs: [{
      agency: '湛江海洋产品检测中心（演示）', reportNo: 'ZJHY-2611-1106', sampled: '2026-11-06', issued: '2026-11-12', sample: '黄鳍鲷肌肉 6 尾混样', category: '渔药残留与重金属',
      items: [
        { name: '氯霉素', result: '未检出', limit: '不得检出', pass: true },
        { name: '孔雀石绿（含隐色）', result: '未检出', limit: '不得检出', pass: true },
        { name: '硝基呋喃类代谢物', result: '未检出', limit: '不得检出', pass: true },
        { name: '恩诺沙星 + 环丙沙星', result: '未检出', limit: '≤ 100 μg/kg', pass: true },
        { name: '铅（以 Pb 计）', result: '0.02 mg/kg', limit: '≤ 0.5 mg/kg', pass: true },
        { name: '镉（以 Cd 计）', result: '< 0.01 mg/kg', limit: '≤ 0.1 mg/kg', pass: true },
      ],
    }],
    photos: [
      { date: '2026-04-02', caption: '放苗', scene: 'seed', source: 'farmer' },
      { date: '2026-06-06', caption: '中期抽样', scene: 'pond', source: 'farmer' },
      { date: '2026-11-06', caption: '抽样封样', scene: 'lab', source: 'lab' },
      { date: '2026-11-20', caption: '起捕冰鲜', scene: 'harvest', source: 'farmer' },
    ],
    provenance: { sensorSamples: 1_394_560, farmerRecords: 337, labDocs: 1, revisions: [{ date: '2026-08-01', field: '死亡数量', before: '420 尾', after: '640 尾', by: '黄场长（演示）', reason: '降雨后 3 天合并补登' }], fingerprint: '13af 6c28 d940 7be5 2f81 a6c0 5d39 e4b2' },
    sensors: 8,
  },
];

const weekly = (base: number, shape: number[]) => shape.map(f => Math.round(base * f));
export const products: readonly Product[] = [
  { id: 'pompano', name: '阳江金鲳鱼', sub: '高位池养成 · 186 天', category: '鱼类', price: 39.8, unit: '条', spec: '约 500–600 g/条 · 冰鲜', stock: 320, sold: 1286, tags: ['检测 8 项合格', '有转塘档案'], art: 'pompano', batchCode: 'HH-YJ-2605-02', b2b: { wholesale: 26.5, inPondKg: 18600, nextHarvest: '2026-12-26', moq: '500 kg', weekly: weekly(3200, [0.6, 0.8, 1, 1, 0.9, 0.7, 1.1, 1.2]) } },
  { id: 'shrimp', name: '南美白对虾', sub: 'SPF 虾苗 · 一次放养', category: '虾类', price: 59.9, unit: '盒（1 kg）', spec: '40–50 只/kg · 冰鲜盒装', stock: 210, sold: 2034, tags: ['检测 5 项合格', '实时水质'], art: 'shrimp', batchCode: 'HH-YJ-2607-03', b2b: { wholesale: 41, inPondKg: 9800, nextHarvest: '2027-01-08', moq: '300 kg', weekly: weekly(1800, [0.4, 0.5, 0.7, 1, 1, 1.2, 1.1, 0.9]) } },
  { id: 'tilapia', name: '茂名吉富罗非鱼', sub: '淡水土塘 · 分塘养成', category: '鱼类', price: 18.8, unit: '条', spec: '约 600–800 g/条 · 鲜活', stock: 560, sold: 3410, tags: ['检测 6 项合格', '有分塘档案'], art: 'tilapia', batchCode: 'HH-MM-2604-01', b2b: { wholesale: 11.2, inPondKg: 15200, nextHarvest: '2026-12-12', moq: '1,000 kg', weekly: weekly(5200, [1, 1, 0.9, 0.9, 0.8, 0.8, 1, 1]) } },
  { id: 'bass', name: '循环水加州鲈', sub: '配合饲料驯化 · 循环水', category: '鱼类', price: 32.6, unit: '条', spec: '约 450–550 g/条 · 鲜活', stock: 280, sold: 1592, tags: ['检测 5 项合格', '8 个探头'], art: 'bass', batchCode: 'HH-MM-2603-03', b2b: { wholesale: 22.8, inPondKg: 7400, nextHarvest: '2027-01-20', moq: '500 kg', weekly: weekly(2100, [0.5, 0.6, 0.6, 0.8, 1, 1, 1.1, 1.2]) } },
  { id: 'grouper', name: '珍珠龙胆石斑', sub: '工厂化循环水 · 恒温', category: '鱼类', price: 118, unit: '条', spec: '约 0.8–1.0 kg/条 · 鲜活', stock: 96, sold: 486, tags: ['检测 5 项合格', '10 个探头'], art: 'grouper', batchCode: 'HH-ZJ-2601-01', b2b: { wholesale: 82, inPondKg: 4300, nextHarvest: '2027-02-10', moq: '200 kg', weekly: weekly(900, [0.3, 0.4, 0.5, 0.6, 0.8, 1, 1, 1]) } },
  { id: 'seabream', name: '湛江黄鳍鲷', sub: '纳潮海水塘 · 冰鲜', category: '鱼类', price: 45.9, unit: '条', spec: '约 350–450 g/条 · 冰鲜', stock: 240, sold: 872, tags: ['检测 6 项合格', '实时水质'], art: 'seabream', batchCode: 'HH-ZJ-2604-02', b2b: { wholesale: 31, inPondKg: 12600, nextHarvest: '2026-12-30', moq: '300 kg', weekly: weekly(2400, [0.7, 0.8, 1, 1, 1, 0.9, 0.9, 1.1]) } },
];

export const demands = [
  { id: 'd1', buyer: '连锁餐饮（演示）', name: '鲜活罗非鱼 · 周期直供', spec: '600–800 g/尾', quantity: '2,000 kg / 周', destination: '广州', delivery: '每周三到店', requirement: '每批附对应批次溯源码与检测报告；活鱼车运输，到店称重验收。', match: 'tilapia' },
  { id: 'd2', buyer: '生鲜电商（演示）', name: '南美白对虾 · 冰鲜盒装', spec: '40–50 只/kg', quantity: '600 kg / 周', destination: '深圳', delivery: '每周一、四', requirement: '提供起捕日期与水质记录；冷链 0–4 ℃，盒贴溯源二维码。', match: 'shrimp' },
  { id: 'd3', buyer: '酒店集团（演示）', name: '珍珠龙胆石斑 · 宴席用鱼', spec: '0.8–1.2 kg/尾', quantity: '300 kg / 月', destination: '珠海', delivery: '每月 2 批', requirement: '充氧活鱼箱运输，提供渔药残留检测报告。', match: 'grouper' },
] as const;

/** 在塘批次（养殖中，尚未上市），用于基地页和 B 端预计供货。 */
export const inPond = [
  { code: 'HH-YJ-2610-01', pondId: 'YJ-01', species: '金鲳鱼苗', stockDate: '2026-10-22', expect: '2027-04 转入养成池', count: '52,000 尾' },
  { code: 'HH-YJ-2608-04', pondId: 'YJ-04', species: '金鲳鱼', stockDate: '2026-08-05', expect: '2026-12-26', count: '约 18,600 kg' },
  { code: 'HH-MM-2604-01B', pondId: 'MM-02', species: '罗非鱼', stockDate: '2026-07-05', expect: '2026-12-12', count: '约 15,200 kg' },
  { code: 'HH-ZJ-2607-03', pondId: 'ZJ-03', species: '黄鳍鲷', stockDate: '2026-07-12', expect: '2026-12-30', count: '约 12,600 kg' },
] as const;

export const platformStats = { sensorsOnline: 128, batchesInPond: 23, tracedBatches: 186, samplesToday: 46080 };

export const metricInfo: Record<Metric, { label: string; unit: string; color: string }> = {
  do: { label: '溶解氧', unit: 'mg/L', color: '#22d3ee' },
  temp: { label: '水温', unit: '℃', color: '#fbbf24' },
  ph: { label: 'pH', unit: '', color: '#a78bfa' },
  nh3: { label: '氨氮', unit: 'mg/L', color: '#34d399' },
};
/** 适宜区间（演示），用于图表底带与达标率计算；不代表国家标准限值。 */
export function metricRange(metric: Metric, water: Water): [number, number] {
  if (metric === 'do') return [5, 12];
  if (metric === 'temp') return water === 'marine' ? [22, 32] : [20, 32];
  if (metric === 'ph') return water === 'marine' ? [7.5, 8.6] : [6.5, 8.5];
  return [0, 0.5];
}

export const sourceLabel: Record<Source, string> = { sensor: '探头自动采集', farmer: '养殖户填写', lab: '机构出具', system: '系统生成' };
export const eventLabel: Record<EventKind, string> = { STOCK: '放苗', SUPPLEMENT: '补苗', TRANSFER: '转塘', SPLIT: '分塘', FEED: '投喂', ALERT: '预警', INSPECTION: '检测', PHOTO: '拍照', MORTALITY: '死亡登记', HARVEST: '起捕' };

// ---------- 查询 ----------
export const findProduct = (id: string | undefined) => products.find(p => p.id === id);
export const findBatch = (code: string | undefined) => batches.find(b => b.code === (code || '').trim().toUpperCase());
export const findBase = (id: string | undefined) => bases.find(b => b.id === id);
export const findPond = (id: string | undefined) => ponds.find(p => p.id === id);
export const pondsOfBase = (id: string) => ponds.filter(p => p.baseId === id);
export const productOfBatch = (batch: Batch) => products.find(p => p.id === batch.productId);

// ---------- 确定性生成 ----------
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function prng(seed: number): () => number {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export interface Point { day: string; value: number }
/** 按日均值生成整个养殖期的水质序列；同一批次同一指标结果恒定；预警日出现对应越线点。 */
export function waterSeries(batch: Batch, metric: Metric): Point[] {
  const water = findBase(batch.baseId)?.water ?? 'marine';
  const days = daysBetween(batch.stockDate, batch.harvestDate) + 1;
  const rand = prng(hash(batch.code + metric));
  const alertDays = new Set(batch.alerts.filter(a => a.metric === metric).map(a => a.date));
  const out: Point[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(batch.stockDate, i);
    const month = Number(day.slice(5, 7));
    const season = Math.sin(((month - 2) / 12) * Math.PI * 2); // 夏季高
    const wave = Math.sin(i / 3.2) * 0.5 + (rand() - 0.5);
    let v: number;
    if (metric === 'temp') v = (water === 'marine' ? 26.5 : 26) + season * 4.2 + wave * 0.6;
    else if (metric === 'do') v = 7.2 - season * 0.7 + wave * 0.45;
    else if (metric === 'ph') v = (water === 'marine' ? 8.05 : 7.4) + wave * 0.12;
    else v = 0.18 + Math.max(0, season) * 0.08 + Math.abs(wave) * 0.06 + (i / days) * 0.08;
    if (alertDays.has(day)) {
      if (metric === 'do') v = 4.7; else if (metric === 'temp') v = water === 'marine' ? 32.8 : 33.6; else if (metric === 'ph') v = 6.4; else v = 0.62;
    }
    out.push({ day, value: round(v, metric === 'temp' ? 1 : 2) });
  }
  return out;
}
export function complianceRate(series: Point[], [lo, hi]: [number, number]): number {
  if (!series.length) return 0;
  return round((series.filter(p => p.value >= lo && p.value <= hi).length / series.length) * 100, 1);
}
export const totalFeedKg = (batch: Batch) => batch.feeds.reduce((sum, f) => sum + f.kg, 0);
/** 饲料系数（演示）：投喂量 / 起捕量。 */
export const feedConversion = (batch: Batch) => round(totalFeedKg(batch) / batch.harvest.qtyKg, 2);
export const cultureDays = (batch: Batch) => daysBetween(batch.stockDate, batch.harvestDate);
/** 溯源完整度：按九类资料是否齐备计分。 */
export function traceCompleteness(batch: Batch): number {
  const checks = [batch.seed.quarantine, batch.lineage.length, batch.feeds.length, batch.events.length >= 5, batch.labs.length,
    batch.photos.length >= 4, batch.provenance.sensorSamples > 0, batch.harvest.qtyKg > 0, batch.labs.some(l => l.category.includes('渔药'))];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
export function sourceShare(batch: Batch): { source: Source; count: number }[] {
  return [
    { source: 'sensor', count: batch.provenance.sensorSamples },
    { source: 'farmer', count: batch.provenance.farmerRecords },
    { source: 'lab', count: batch.labs.reduce((n, l) => n + l.items.length, 0) },
  ];
}

export interface Reading { do: number; temp: number; ph: number; nh3: number; online: boolean }
/** 读数显示：水温 1 位小数，其余 2 位。 */
export const readingText = (metric: Metric, v: number) => v.toFixed(metric === 'temp' ? 1 : 2);
/** 塘口实时读数（演示）：按塘与时间片确定性小幅波动。 */
export function liveReading(pondId: string, tick: number): Reading {
  const pond = findPond(pondId);
  const water = findBase(pond?.baseId)?.water ?? 'marine';
  const h = hash(pondId) % 1000 / 1000;
  const w = Math.sin(tick / 2.7 + h * 6) * 0.5 + Math.sin(tick / 1.3 + h * 3) * 0.2;
  const idle = pond?.status === 'idle';
  return {
    do: round(6.9 + h * 0.8 + w * 0.3, 2), temp: round((water === 'marine' ? 23.6 : 22.4) + h * 1.2 + w * 0.15, 1),
    ph: round((water === 'marine' ? 8.02 : 7.35) + w * 0.05, 2), nh3: round(0.16 + h * 0.08 + Math.abs(w) * 0.02, 2), online: !idle,
  };
}

/** AI 助手预设问答：只引用演示档案中的事实。 */
export function aiAnswers(batch: Batch): { q: string; a: string }[] {
  const base = findBase(batch.baseId)!;
  const pond = findPond(batch.pondId)!;
  const drug = batch.labs.find(l => l.category.includes('渔药'));
  const doRate = complianceRate(waterSeries(batch, 'do'), metricRange('do', base.water));
  const tempRate = complianceRate(waterSeries(batch, 'temp'), metricRange('temp', base.water));
  return [
    { q: '这条鱼是从哪里来的？', a: `来自${company.short}${base.name}（${base.region}）的${pond.name}，批次号 ${batch.code}。${batch.lineage.length > 1 ? `养殖期间经历了${batch.lineage.map(l => l.stage).join('、')}，每次转移都有数量和照片记录。` : '整个养殖期都在这口塘，没有转塘。'}` },
    { q: '打过药吗？检测结果怎么样？', a: drug ? `${drug.agency}于 ${drug.sampled} 抽样，对 ${drug.items.length} 个项目进行检测（报告号 ${drug.reportNo}），${drug.items.filter(i => i.pass).length} 项全部符合对照限值，其中禁用药物项目均为“未检出”。检测报告可在溯源档案中查看原件信息。` : '本批次暂无渔药残留检测报告。' },
    { q: '水质怎么样？', a: `养殖期 ${cultureDays(batch)} 天，塘里装了 ${batch.sensors} 个探头，累计自动采集 ${batch.provenance.sensorSamples.toLocaleString('zh-CN')} 条数据。溶解氧日均值达标率 ${doRate}%，水温适宜率 ${tempRate}%。${batch.alerts.length ? `期间有 ${batch.alerts.length} 次提醒/预警，均已处理：${batch.alerts.map(a => `${a.date} ${metricInfo[a.metric].label} ${a.value}，${a.action}，${a.recoveredIn}恢复`).join('；')}。` : '期间没有触发预警。'}` },
    { q: '吃的是什么饲料？', a: `全程使用 ${new Set(batch.feeds.map(f => f.brand)).size} 个品牌的配合饲料，共 ${batch.feeds.length} 个批号，累计投喂 ${(totalFeedKg(batch) / 1000).toFixed(1)} 吨，饲料系数约 ${feedConversion(batch)}。分阶段为：${batch.feeds.map(f => `${f.stage}${f.product}（批号 ${f.lot}）`).join('；')}。` },
    { q: '养了多久？什么时候捕的？', a: `${batch.stockDate} 放苗，${batch.harvestDate} 起捕，共养殖 ${cultureDays(batch)} 天。起捕 ${batch.harvest.qtyKg.toLocaleString('zh-CN')} kg，规格 ${batch.harvest.spec}，${batch.harvest.method}。` },
    { q: '这些数据可信吗？', a: `每条数据都标注了来源：探头自动采集 ${batch.provenance.sensorSamples.toLocaleString('zh-CN')} 条、养殖户填写 ${batch.provenance.farmerRecords} 条、机构出具 ${batch.labs.length} 份报告。所有修改都保留修订记录（本批次 ${batch.provenance.revisions.length} 次），档案生成后计算数据指纹，任何改动都会产生新版本。` },
  ];
}
export const generalQuestions = [
  { q: '怎么查一条鱼的来源？', a: '在商品页点击“查看完整溯源档案”，或在“溯源查询”输入包装上的批次码（例如 HH-YJ-2605-02），就能看到公司、基地、塘口、养殖过程与检测报告。' },
  { q: '溯源数据从哪里来？', a: '水质来自塘里的物联网探头自动采集；放苗、投喂、转塘、起捕由养殖户在确权小程序里登记；检测报告由第三方机构出具。三类来源在档案中分别标注。' },
  { q: '企业可以批量采购吗？', a: '可以。在“产地采购”可查看在塘存量、预计起捕时间和未来 8 周供货量，发布采购需求或直接询价。' },
];
