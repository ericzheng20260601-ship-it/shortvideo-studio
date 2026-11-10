export const TRACKS = [
  { id:'pet-snack',  name:'宠物零食', emoji:'🦴', grad:'linear-gradient(145deg,#e8f3ea,#cfe7dd)' },
  { id:'pet-toy',    name:'宠物玩具', emoji:'🧸', grad:'linear-gradient(145deg,#f4eee4,#e8dcc9)' },
  { id:'pet-train',  name:'宠物训练', emoji:'🐾', grad:'linear-gradient(145deg,#e3f1ef,#c9e4df)' },
  { id:'pet-chew',   name:'宠物磨牙', emoji:'🦷', grad:'linear-gradient(145deg,#f0efe6,#dfe4d2)' },
  { id:'skincare',   name:'女性护肤', emoji:'🧴', grad:'linear-gradient(145deg,#f6ecef,#ecdde4)' },
  { id:'fragrance',  name:'香水香氛', emoji:'🌿', grad:'linear-gradient(145deg,#eaeef6,#dce2f0)' },
  { id:'knowledge',  name:'知识科普', emoji:'💡', grad:'linear-gradient(145deg,#e9f2f6,#d8e6ee)' },
];
export const trackOf = id => TRACKS.find(t => t.id === id) || TRACKS[0];

export const AUDIENCES = ['养宠新手','资深铲屎官','25-35 岁职场女性','精致生活人群','成分党','泛兴趣人群'];
export const STYLES = ['共情叙事','专业测评','轻松幽默','快节奏种草','温柔治愈'];
export const DURATIONS = [
  { v:15, label:'15 秒', hook:2, body:9, cta:4 },
  { v:30, label:'30 秒', hook:3, body:21, cta:6 },
  { v:45, label:'45 秒', hook:4, body:33, cta:8 },
  { v:60, label:'60 秒', hook:5, body:45, cta:10 },
];
export const NARRATION = ['共情叙事','专业测评','轻松幽默','快节奏种草','温柔治愈','沉稳纪录片感'];

export const QUOTES = [
  ['把今天的小事做好，就是给未来的自己铺路。','Do the small things well today; you are paving the road for tomorrow.'],
  ['不必等到完美才开始，开始本身就在让它变完美。','You do not have to be great to start; starting makes you great.'],
  ['每一次认真打磨，都会在某个镜头里被看见。','Every careful polish shows up in a frame sooner or later.'],
  ['稳定的输出，比偶尔的爆发更接近答案。','Consistent output is closer to the answer than an occasional burst.'],
  ['先讲清一个问题，再谈一个产品。','Solve one problem clearly before you talk about the product.'],
  ['好内容不靠灵感，靠可复用的结构。','Good content runs on reusable structures, not on inspiration.'],
  ['慢一点也没关系，方向对就不算绕路。','Going slower is fine; the right direction is never a detour.'],
  ['把复杂留给自己，把简单留给观众。','Keep the complexity on your side; hand the audience the simple part.'],
  ['今天多改一版，明天少返工一次。','One more revision today saves one round of rework tomorrow.'],
  ['真正打动人的，往往是被看见的细节。','What moves people is usually the detail they feel seen in.'],
  ['流量会波动，判断力会复利。','Traffic fluctuates; judgment compounds.'],
  ['把镜头对准真实，观众自然会靠近。','Point the camera at something real and the audience leans in.'],
  ['先完成，再完美，最后才规模化。','Finish it, refine it, and only then scale it.'],
  ['数据告诉你发生了什么，人告诉你为什么。','Data tells you what happened; people tell you why.'],
];
export const quoteIndexByDate = (d = new Date()) => {
  const key = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
  return key % QUOTES.length;
};

export const RADAR = [
  { id:'r1', track:'pet-chew', title:'狗狗拆家停不下来？一根磨牙棒让它安静 40 分钟', author:'@paws.daily', dur:'00:28', views:8200000, saves:123800, heat:96, emoji:'🦷', tags:['磨牙','拆家救星'], ai:false, ad:false,
    product:'天然鹿角磨牙棒', hook:'你家狗是不是一转身就把沙发咬了？', pain:'拆家、焦虑、乱咬', proof:'连续 7 天实测 + 前后对比', cta:'评论区扣 1 领取尺寸对照表' },
  { id:'r2', track:'skincare', title:'30 岁以后才明白：早 C 晚 A 根本不用那么复杂', author:'@skin.notes', dur:'01:14', views:4600000, saves:89900, heat:93, emoji:'🧴', tags:['早C晚A','精简护肤'], ai:false, ad:false,
    product:'温和视黄醇精华', hook:'别再一层一层往脸上糊了。', pain:'步骤太多、烂脸、成分打架', proof:'成分表逐条对比 + 28 天记录', cta:'主页置顶有新手排班表' },
  { id:'r3', track:'fragrance', title:'被问了 200 次的「干净皂感」香，其实是这三支', author:'@scent.log', dur:'00:47', views:3900000, saves:68200, heat:91, emoji:'🌿', tags:['皂感','留香'], ai:false, ad:true,
    product:'白茶木质调香水', hook:'不是浓才好闻，是刚洗完衣服那种味道。', pain:'撞香、甜腻、留香短', proof:'前中后调卡片 + 试香纸实拍', cta:'收藏这条，下次柜台直接对号' },
  { id:'r4', track:'pet-train', title:'3 天教会狗狗「等一下」，不用喊不用拽', author:'@train.with.kai', dur:'01:02', views:3800000, saves:112000, heat:90, emoji:'🐾', tags:['正向训练','口令'], ai:false, ad:false,
    product:'训练响片 + 零食袋', hook:'别再拽牵引绳了，它只是没听懂。', pain:'扑人、抢食、出门爆冲', proof:'三段递进训练实拍', cta:'合集里有第 2 天和第 3 天' },
  { id:'r5', track:'pet-toy', title:'9 块的漏食球，比我买过的所有益智玩具都管用', author:'@two.cats.one.dog', dur:'00:09', views:3700000, saves:46700, heat:88, emoji:'🧸', tags:['漏食','独处'], ai:false, ad:true,
    product:'硅胶漏食球', hook:'出门前给它这个，回来它还没玩够。', pain:'分离焦虑、无聊吠叫', proof:'一镜到底 9 秒实拍', cta:'小黄车第二个尺寸别买错' },
  { id:'r6', track:'pet-snack', title:'配料表只有一行，我才敢每天给猫吃', author:'@ingredient.first', dur:'00:36', views:4100000, saves:93400, heat:92, emoji:'🦴', tags:['冻干','配料表'], ai:true, ad:false,
    product:'单一肉源冻干', hook:'翻到背面看一眼，你就知道该不该买。', pain:'诱食剂、肉粉、来源不明', proof:'配料表放大逐字读', cta:'截图保存这张配料表清单' },
  { id:'r7', track:'skincare', title:'换季烂脸不是缺水，是屏障在报警', author:'@derm.talk', dur:'00:52', views:3300000, saves:78100, heat:87, emoji:'💧', tags:['屏障','换季'], ai:false, ad:false,
    product:'神经酰胺面霜', hook:'敷了三天面膜还刺痛？先停手。', pain:'泛红、刺痛、越补水越干', proof:'皮肤科医师口述 + 修护时间线', cta:'把你的护肤步骤发我看看' },
  { id:'r8', track:'knowledge', title:'为什么宠物不能吃木糖醇？90 秒讲清原理', author:'@pet.science', dur:'01:30', views:2900000, saves:156000, heat:89, emoji:'💡', tags:['科普','安全'], ai:true, ad:false,
    product:'宠物安全手册', hook:'无糖口香糖，对它可能是致命的。', pain:'误食风险、信息碎片', proof:'机理动画 + 剂量对照', cta:'转给每一个养狗的朋友' },
  { id:'r9', track:'fragrance', title:'香水别再喷手腕了，这三个位置留香翻倍', author:'@scent.log', dur:'00:24', views:2600000, saves:64100, heat:84, emoji:'🌸', tags:['用法','留香'], ai:false, ad:false,
    product:'随身分装瓶', hook:'喷了等于白喷，位置不对。', pain:'留香短、味道散得快', proof:'三处体温点示意', cta:'明天出门试试第二个' },
  { id:'r10', track:'pet-train', title:'猫咪不亲人？先别抱，做对这一步就行', author:'@cat.behavior', dur:'00:41', views:2400000, saves:88700, heat:83, emoji:'🐱', tags:['行为','亲和'], ai:false, ad:false,
    product:'互动逗猫棒', hook:'它躲你，不是不喜欢你。', pain:'躲人、不让摸、应激', proof:'行为学拆解 + 实拍示范', cta:'合集第 3 条讲进阶' },
  { id:'r11', track:'pet-chew', title:'幼犬换牙期，这 4 类磨牙物别买', author:'@paws.daily', dur:'00:33', views:2100000, saves:72300, heat:81, emoji:'🦴', tags:['换牙','避坑'], ai:true, ad:false,
    product:'软胶磨牙环', hook:'第 3 种很多人家里现在就有。', pain:'划伤口腔、误吞', proof:'材质硬度对比实验', cta:'收藏，买之前翻出来看' },
  { id:'r12', track:'skincare', title:'底妆卡粉，问题八成出在这一步之前', author:'@skin.notes', dur:'00:38', views:1900000, saves:51900, heat:79, emoji:'✨', tags:['底妆','妆前'], ai:false, ad:true,
    product:'妆前保湿乳', hook:'不是粉底不好，是脸没准备好。', pain:'卡粉、斑驳、脱妆', proof:'半脸对照实拍', cta:'评论区报你的肤质' },
];

export const CHECKLIST = [
  { id:'c1', title:'标题有没有利益点', desc:'观众 1 秒内知道「关我什么事」' },
  { id:'c2', title:'前 3 秒够不够快', desc:'先给冲突/结果，不铺垫不寒暄' },
  { id:'c3', title:'字幕有没有错别字', desc:'尤其产品名、成分名、口令词' },
  { id:'c4', title:'封面和标题是否一致', desc:'避免标题党造成的跳出' },
  { id:'c5', title:'话题标签 3 到 5 个', desc:'大词 + 赛道词 + 场景词组合' },
  { id:'c6', title:'版权音乐与素材', desc:'商用授权、肖像与宠物出镜同意' },
];

export const PLATFORMS = [
  { id:'tiktok', name:'TikTok', sub:'创作者中心', color:'#26383c', url:'https://www.tiktok.com/creator-center/' },
  { id:'x', name:'X', sub:'发布动态', color:'#3c4a4d', url:'https://x.com/compose/post' },
  { id:'meta', name:'Meta', sub:'商务套件', color:'#4b7ba3', url:'https://business.facebook.com/latest/content_management' },
  { id:'youtube', name:'YouTube', sub:'创作工作室', color:'#c07b7b', url:'https://studio.youtube.com/' },
  { id:'instagram', name:'Instagram', sub:'发布 Reels', color:'#a37ba3', url:'https://www.instagram.com/' },
  { id:'pinterest', name:'Pinterest', sub:'发布 Idea Pin', color:'#b06a6a', url:'https://www.pinterest.com/' },
];

export const AUTO_STEPS = ['载入视频','抽取关键帧','识别画面','生成解说','排字幕与同期','匹配配乐'];

export const SCRIPT_LIB = {
  'pet-snack': {
    hooks:['配料表只有一行，我才敢每天给它吃。','你以为在补营养，其实在喂诱食剂。','翻到背面看一眼，三秒判断这袋能不能买。'],
    points:['先看肉源：单一肉源比混合肉粉更好追溯。','再看工艺：冻干能保留更多原始风味，适口性更稳。','最后看添加：诱食剂、色素、防腐剂能省则省。','用法上，拌粮比当正餐更稳妥，第一次给只给一小撮。'],
    cta:['截图保存这张配料表清单，下次买直接对。','评论区告诉我你家挑不挑食，我帮你排一下。'],
  },
  'pet-toy': {
    hooks:['出门前给它这个，回来它还没玩够。','9 块钱的东西，解决了我最头疼的一小时。','别再买会叫的玩具了，它需要的是动脑。'],
    points:['漏食球的核心不是玩具，是让鼻子先工作 15 分钟。','尺寸按嘴型选，太小有误吞风险，太大它会直接放弃。','第一次把难度调到最低，让它马上尝到甜头。','独处场景最有效：出门前十分钟给，不要临走才给。'],
    cta:['小黄车第二个尺寸别买错，按体重选。','收藏这条，明天出门前试一次。'],
  },
  'pet-train': {
    hooks:['别再拽牵引绳了，它只是没听懂。','三天，一个口令，不用喊也不用拽。','它扑人不是不乖，是没人告诉它该做什么。'],
    points:['第一步：把「等一下」和一个固定手势绑定，口令只说一次。','第二步：安静的那一秒立刻奖励，时机比数量重要。','第三步：把等待时长从 1 秒慢慢拉到 10 秒，别跳级。','全程不惩罚，错了就重来，保持成功率在八成以上。'],
    cta:['合集里有第 2 天和第 3 天，按顺序练。','把你的训练卡点发评论区，我下条拍。'],
  },
  'pet-chew': {
    hooks:['你家狗是不是一转身就把沙发咬了？','换牙期这 4 类磨牙物，别买。','不是它调皮，是牙床真的痒。'],
    points:['先排除过硬材质：指甲能划出印子的才算安全区间。','再排除会碎成小块的类型，误吞比磨损更麻烦。','冻过的软胶环能同时缓解肿胀和痒感。','每天固定两个时段给，形成预期后拆家会明显减少。'],
    cta:['收藏，买之前翻出来对照一遍。','评论区扣 1 领取按体重的尺寸表。'],
  },
  'skincare': {
    hooks:['别再一层一层往脸上糊了。','敷了三天面膜还刺痛？先停手。','底妆卡粉，问题八成出在这一步之前。'],
    points:['先判断是缺水还是屏障受损：刺痛、泛红属于后者。','屏障期做减法：洁面、保湿、防晒，三步就够。','活性成分等稳定后再回来，一次只加一个变量。','记录比堆产品有用，28 天同一光线拍一张。'],
    cta:['主页置顶有新手排班表，直接照着做。','评论区报你的肤质，我给你排个顺序。'],
  },
  'fragrance': {
    hooks:['不是浓才好闻，是刚洗完衣服那种味道。','喷了等于白喷，位置不对。','被问了 200 次，其实是这三支。'],
    points:['先定义场景：通勤要干净，约会才要记忆点。','前调决定第一印象，别在柜台前 10 秒就下判断。','喷在体温高的位置，比喷衣服留香更自然。','一次只试两支，超过三支鼻子就不可信了。'],
    cta:['收藏这条，下次柜台直接对号。','明天出门试试第二个位置。'],
  },
  'knowledge': {
    hooks:['无糖口香糖，对它可能是致命的。','90 秒讲清原理，不讲结论先行。','这条建议转给每一个养狗的朋友。'],
    points:['先说结论：木糖醇会引发犬类胰岛素快速释放。','再说机制：血糖骤降比「有毒」三个字更值得记住。','给出剂量对照，避免制造无意义恐慌。','最后给动作：收好包、看配料表、记住应急电话。'],
    cta:['转给每一个养狗的朋友，比收藏更有用。','想看下一期讲什么，评论区点题。'],
  },
};

export const BREAKDOWN_LABELS = [
  { key:'hook',  name:'钩子 · 前 3 秒', color:'#3f9d8f', tip:'用冲突、反常识或结果先抓住注意力' },
  { key:'pain',  name:'痛点 · 共鸣',   color:'#6d9dc3', tip:'把观众正在经历的具体麻烦说中' },
  { key:'proof',name:'证据 · 可信',   color:'#8d86bd', tip:'实测、成分、对比、时间线，给可验证的东西' },
  { key:'value',name:'卖点 · 信息',   color:'#c99a5c', tip:'只留一个主卖点，附带一个使用边界' },
  { key:'cta',   name:'CTA · 行动',   color:'#c98a8a', tip:'一个动作，低门槛，可立即执行' },
];
