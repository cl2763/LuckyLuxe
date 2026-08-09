/* 中文姓名 → 拼音(只给「生成登录账号」的用户名用)。

   为什么自己带一张表:仓库是零依赖的(node:sqlite + 原生 http),不为了一个用户名引一个 100KB 的
   拼音库。这里收的是**人名里真正会用到的字**——百家姓 + 常见名字用字,约 600 个。
   查不到的字直接跳过;整个名字都查不到时由调用方回落到 'staff'。
   店主在建号弹窗里可以直接改用户名,所以这张表不需要覆盖到每一个生僻字。 */

// 每行:拼音 → 该读音下的常见字。多音字取人名里最常见的那个读音。
const TABLE = {
  a: '阿', ai: '艾爱蔼', an: '安岸', ao: '敖傲奥',
  ba: '巴八', bai: '白百柏', ban: '班', bao: '包宝保鲍葆', bei: '贝北', ben: '本', bi: '毕碧璧必壁',
  bian: '边卞', biao: '彪', bin: '斌彬滨宾', bing: '冰兵秉炳丙', bo: '波博伯勃薄柏',
  bu: '卜步',
  cai: '蔡才财彩菜', can: '灿', cang: '苍', cao: '曹操草', ce: '策', ceng: '曾',
  cha: '查', chai: '柴', chan: '婵', chang: '常昌长畅倡', chao: '超朝潮',
  chen: '陈晨辰臣宸沉', cheng: '成程诚承城橙', chi: '池驰', chong: '崇冲',
  chu: '楚初储', chuan: '川传', chun: '春纯淳', ci: '慈',
  cong: '聪丛', cui: '崔翠萃', cun: '存',
  da: '达大', dai: '戴代黛', dan: '丹单旦', dang: '党', dao: '道',
  de: '德', deng: '邓登', di: '狄迪笛帝', dian: '典', diao: '刁',
  die: '蝶', ding: '丁定鼎', dong: '董东冬栋洞', dou: '窦豆',
  du: '杜独度都渡', duan: '段端', dui: '', dun: '敦', duo: '多朵铎',
  e: '鄂', en: '恩', er: '尔二',
  fa: '发法', fan: '范凡樊繁帆凡', fang: '方房芳防', fei: '菲飞非斐',
  fen: '芬纷', feng: '冯峰风封锋丰枫凤', fo: '', fu: '付傅福富符浮甫芙馥',
  gai: '盖', gan: '甘干', gang: '刚钢岗', gao: '高告',
  ge: '葛戈格阁', gen: '根', geng: '耿更庚', gong: '龚公宫巩功',
  gou: '苟', gu: '古顾谷贾固', gua: '', guan: '关官管冠', guang: '广光',
  gui: '桂贵归圭', gun: '', guo: '郭国果过',
  ha: '哈', hai: '海', han: '韩含涵寒晗汉', hang: '航杭', hao: '郝好豪浩皓昊',
  he: '何贺和赫鹤禾河合荷', hei: '', heng: '恒衡', hong: '洪红宏虹弘鸿',
  hou: '侯厚', hu: '胡虎湖户扈', hua: '华花桦', huai: '怀淮', huan: '欢桓寰',
  huang: '黄煌皇凰', hui: '辉慧惠回汇卉徽', hun: '', huo: '霍活火获',
  ji: '纪吉季基季济佶集积继纪嘉姬', jia: '贾佳嘉家甲加珈', jian: '简健建剑坚见键',
  jiang: '姜江蒋将强疆', jiao: '焦娇姣', jie: '解杰洁婕捷杰界节结介竭',
  jin: '金晋进锦津瑾谨', jing: '静京经景晶敬井靖婧净竞',
  jiong: '', jiu: '久酒', ju: '居菊举巨鞠', juan: '娟涓', jue: '珏', jun: '君俊军均骏钧',
  ka: '', kai: '凯开楷', kan: '', kang: '康抗', kao: '', ke: '柯克科可珂颗',
  ken: '', kong: '孔空', kou: '寇', ku: '', kua: '', kuai: '蒯', kuan: '宽',
  kuang: '匡邝旷', kui: '奎葵', kun: '坤昆', kuo: '阔',
  la: '', lai: '来赖莱', lan: '兰岚蓝澜篮', lang: '郎朗浪', lao: '劳老',
  le: '乐勒', lei: '雷蕾磊累', leng: '冷', li: '李黎丽利力立理礼莉璃厉栗历郦荔',
  lian: '连莲廉练', liang: '梁良亮量粮', liao: '廖辽', lie: '',
  lin: '林琳霖临麟淋', ling: '凌灵铃玲岭令', liu: '刘柳留六流琉',
  long: '龙隆珑', lou: '娄楼', lu: '陆卢鲁路露璐禄芦录',
  luan: '栾', lun: '伦', luo: '罗骆洛络萝',
  lv: '吕绿律旅', lve: '',
  ma: '马麻玛', mai: '麦买', man: '满曼漫', mang: '', mao: '毛茅茂',
  mei: '梅美媚眉玫', men: '门', meng: '孟梦蒙萌猛盟',
  mi: '米密宓', mian: '绵', miao: '苗妙缪淼', mie: '', min: '闵敏民珉',
  ming: '明铭鸣命', miu: '', mo: '莫墨沫默漠', mou: '牟某', mu: '穆木牧慕沐母',
  na: '娜纳那', nai: '奈', nan: '南楠男', nang: '', nao: '', ne: '',
  nei: '', nen: '嫩', neng: '能', ni: '倪妮尼霓泥', nian: '念年',
  niang: '', niao: '', nie: '聂', nin: '', ning: '宁凝柠', niu: '牛纽',
  nong: '农浓', nu: '', nuan: '暖', nuo: '诺娜',
  ou: '欧偶', pa: '', pai: '', pan: '潘盘攀畔', pang: '庞旁',
  pao: '', pei: '裴培佩沛珮', pen: '', peng: '彭鹏朋蓬澎',
  pi: '皮', pian: '', piao: '朴飘', pin: '品', ping: '平萍苹凭',
  po: '', pu: '普蒲濮朴浦',
  qi: '齐祁戚琪奇棋启祺淇绮气其麒', qia: '', qian: '钱前千倩迁乾谦签',
  qiang: '强枪', qiao: '乔巧桥樵俏', qie: '', qin: '秦琴钦沁勤芹亲',
  qing: '青清庆卿晴轻情', qiong: '琼穷', qiu: '邱丘秋裘求',
  qu: '曲屈渠瞿', quan: '权全泉铨', que: '', qun: '群',
  ran: '冉然染', rang: '', rao: '饶', re: '', ren: '任仁人忍韧',
  reng: '', ri: '日', rong: '荣容蓉融戎绒', rou: '柔', ru: '茹儒如汝',
  ruan: '阮软', rui: '瑞睿蕊芮', run: '润', ruo: '若',
  sa: '萨', sai: '赛', san: '三伞', sang: '桑', sao: '', se: '',
  sen: '森', seng: '', sha: '沙莎', shai: '', shan: '单山善杉衫珊闪',
  shang: '尚上商', shao: '邵韶少绍勺', she: '佘社舍', shen: '沈申深神慎审',
  sheng: '盛生升胜声圣', shi: '石施史师时诗士世实史仕', shou: '寿守首',
  shu: '舒淑书树殊叔署曙', shuai: '帅', shuan: '', shuang: '双霜爽',
  shui: '水', shun: '顺舜', shuo: '硕烁',
  si: '司思斯丝四姒', song: '宋松颂嵩淞', sou: '', su: '苏素速肃粟宿夙',
  suan: '', sui: '隋遂穗随', sun: '孙笋损', suo: '索',
  ta: '', tai: '太泰台', tan: '谭覃檀谈坛潭', tang: '唐汤堂棠糖塘螳',
  tao: '陶涛桃淘韬', te: '', teng: '滕腾藤', ti: '提体', tian: '田天甜恬添',
  tiao: '', tie: '铁', ting: '婷亭庭廷停霆挺', tong: '童佟同桐通铜彤统',
  tou: '', tu: '涂屠图土', tuan: '团', tui: '', tun: '', tuo: '拓托妥',
  wa: '娃', wai: '', wan: '万宛婉万晚湾玩', wang: '王汪望旺往',
  wei: '魏卫韦维伟威薇伟未唯巍蔚炜纬', wen: '文温闻雯稳问', weng: '翁',
  wo: '沃', wu: '吴武伍吾五武物午梧',
  xi: '席习西希熙曦溪锡夕昔', xia: '夏霞侠峡', xian: '冼先咸贤显仙娴宪现',
  xiang: '向项相香祥翔湘想乡', xiao: '肖萧晓小笑霄潇孝校',
  xie: '谢解协燮谐', xin: '辛新欣鑫馨心信', xing: '邢兴行星幸刑形',
  xiong: '熊雄', xiu: '修秀绣', xu: '徐许旭序续煦须叙',
  xuan: '宣轩萱璇玄暄', xue: '薛雪学血穴', xun: '荀寻询巡训',
  ya: '亚雅娅牙芽哑压', yan: '严阎颜燕言彦艳岩延妍晏焉雁研炎',
  yang: '杨阳洋扬羊仰养漾', yao: '姚尧遥瑶摇药耀窈',
  ye: '叶业野也冶', yi: '易伊怡宜依仪义亿翼奕逸一乙艺屹熠毅',
  yin: '殷尹银印音茵吟寅', ying: '应英颖莹樱营影迎盈瑛',
  yong: '雍勇永咏泳涌', you: '尤游优友有幼佑', yu: '于余俞虞禹宇雨玉育誉裕豫愉渝屿',
  yuan: '袁元原源远苑媛圆缘', yue: '岳月乐悦跃越阅', yun: '云郓运韵允芸昀',
  za: '', zai: '', zan: '', zang: '臧', zao: '早', ze: '泽则',
  zeng: '曾增', zha: '查扎', zhai: '翟宅', zhan: '詹展占战湛',
  zhang: '张章丈长掌漳', zhao: '赵肇兆昭召照朝', zhe: '哲喆折浙',
  zhen: '甄珍真臻贞振震镇', zheng: '郑正政征争峥筝证',
  zhi: '智志之知芝植枝直织执致', zhong: '钟仲忠中终众重',
  zhou: '周舟州洲宙粥', zhu: '朱祝竺诸主珠竹柱助注驻铸筑',
  zhuan: '', zhuang: '庄壮妆装', zhui: '', zhun: '', zhuo: '卓灼',
  zi: '子紫资姿滋自梓', zong: '宗综总', zou: '邹走', zu: '祖足族',
  zuan: '', zui: '', zun: '尊', zuo: '左作佐坐'
}

// 反向索引:汉字 → 拼音(建一次,常驻)
const CHAR_TO_PINYIN = new Map()
for (const [py, chars] of Object.entries(TABLE)) {
  const syllable = py.replace(/\d+$/, '')
  for (const ch of chars) if (!CHAR_TO_PINYIN.has(ch)) CHAR_TO_PINYIN.set(ch, syllable)
}

/* 姓名 → 用户名候选:
     - 英文名/含英文的名字:直接取 [a-z0-9]
     - 中文名:逐字转拼音拼起来(小婕 → xiaojie)
     - 查不到的字跳过;整串为空时返回 ''(调用方回落到 'staff') */
export function nameToUsername(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const ascii = raw.toLowerCase().replace(/[^a-z0-9]/g, '')
  const hanzi = [...raw].filter((ch) => CHAR_TO_PINYIN.has(ch)).map((ch) => CHAR_TO_PINYIN.get(ch)).join('')
  // 名字里既有英文又有中文时,英文优先(那通常就是本人惯用的写法)
  const out = ascii || hanzi
  return out.slice(0, 16)
}

// 用户名合法性:只允许英数,3–20 位(店主可在建号弹窗里自己改)
export function isValidUsername(value) {
  return /^[a-z0-9]{3,20}$/.test(String(value || '').toLowerCase())
}
