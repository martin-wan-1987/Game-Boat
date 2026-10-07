import {SHIP} from './carrier-layout.js';
import {TANKER} from './tanker-layout.js';
import {DESTROYER,BATTLESHIP,PILOT} from './new-vessel-layout.js';
import {createCarrier} from './ship.js';
import {createTanker} from './tanker.js';
import {createDestroyer,createBattleship,createPilot} from './naval-vessels.js';
import {HOUBEI,LIAONING,SPIRIT,YAMATO,IOWA,TYPHOON} from './expanded-vessel-layout.js';
import {createHoubei,createLiaoning,createSpirit,createYamato,createIowa,createTyphoon} from './expanded-vessels.js';
import {MODERN_WARSHIPS} from './modern-warship-layout.js';
import {createModernWarship} from './modern-warships.js';
import {NUCLEAR_CARRIERS} from './nuclear-carrier-layout.js';
import {createNuclearCarrier} from './nuclear-carriers.js';
import {CONTAINER_SHIPS,CRUISE_SHIPS} from './commercial-layout.js';
import {createContainerShip,createCruiseShip} from './commercial-vessels.js';

/** Build set and hangar cards consume one ordered fleet registry. */
export const FLEET=[
  {spec:SHIP,combat:'enterprise',build:createCarrier,icon:'🛳',type:'核动力航母',description:'服役后期企业号：斜角着舰甲板、四部升降机、双层雷达桅杆、四轴五叶桨。',load:'1–5 架战机 · 近防炮'},
  {spec:TANKER,build:createTanker,icon:'⚓',type:'超大型油轮',description:'连续货油管线、船尾生活区与大型单轴推进器；保持空载压载航态。',load:'空载压载航态'},
  {spec:DESTROYER,combat:'destroyer',build:createDestroyer,icon:'⚓',type:'导弹驱逐舰',description:'南昌舰 101：隐身舰桥、综合桅杆、112 个垂发单元、舰艉直升机甲板与双轴推进。',load:'空载航态 · 主炮火光 · 近防炮'},
  {spec:BATTLESHIP,combat:'iowa',build:createBattleship,icon:'⚓',type:'战列舰',description:'1980 年代改装密苏里号：三座三联装主炮、六座副炮、双烟囱、轻微锈迹与强劲四轴动力。',load:'全炮选舷齐射 · 近防炮'},
  {spec:PILOT,build:createPilot,icon:'🚤',type:'全封闭领航艇',description:'参考 Safehaven Interceptor 48：密封高浮力驾驶舱、厚橡胶护舷、浅吃水与高速双机。',load:'高储备浮力 · 舰体随浪抬升'},
  {spec:HOUBEI,combat:'missileBoat',build:createHoubei,icon:'⚓',type:'双体导弹艇',description:'022 型：双体穿浪船壳、隐身舰桥、八个倾斜导弹发射筒与近防炮。',load:'双体空载航态 · 近防炮'},
  {spec:LIAONING,combat:'chineseCarrier',build:createLiaoning,icon:'🛳',type:'滑跃航空母舰',description:'辽宁舰 16：舰艏滑跃起飞坡、斜角甲板、右舷舰岛和甲板战机。',load:'1–5 架战机 · 近防炮'},
  {spec:SPIRIT,build:createSpirit,icon:'🚤',type:'喷气水上竞速艇',description:'参考澳大利亚精神号：三点支承船体、后置喷气发动机、双进气口与白色竞速外观。',load:'最高 511 km/h · 高储备浮力'},
  {spec:YAMATO,combat:'yamato',build:createYamato,icon:'⚓',type:'重型战列舰',description:'大和号：三座三联装 460 mm 主炮、宝塔舰桥、副炮与防空炮。',load:'选舷齐射 · 旋转主炮 · 强后坐力'},
  {spec:IOWA,combat:'iowa',build:createIowa,icon:'⚓',type:'衣阿华级战列舰',description:'衣阿华 BB-61：三座三联装 406 mm 主炮、双联装副炮、四轴动力。',load:'选舷齐射 · 旋转主炮 · 强后坐力'},
  {spec:TYPHOON,combat:'submarine',build:createTyphoon,icon:'⚓',type:'核动力潜艇',description:'941 台风级：宽体船壳、双轴推进、导弹舱盖和可伸缩潜望镜。',load:'海面航行 · 可伸缩潜望镜'},
  ...MODERN_WARSHIPS.map(spec=>({spec,combat:'destroyer',build:options=>createModernWarship(spec,options),icon:'⚓',type:'导弹驱逐舰',
    description:`${spec.designation}：独立舰壳、雷达、垂发与舰艉直升机平台布置。`,load:'自动主炮 · 近防炮 · 20 发导弹'})),
  ...NUCLEAR_CARRIERS.map(spec=>({spec,combat:spec.family,build:options=>createNuclearCarrier(spec,options),icon:'🛳',type:spec.family==='ford'?'福特级核动力航母':'尼米兹级核动力航母',
    description:spec.family==='ford'?'后移舰岛、综合雷达、三部升降机、四条电磁弹射轨道及独立舰载机。':'尼米兹级斜角甲板、四部升降机、四条弹射轨道及各舰独立舰岛雷达配置。',load:'3–5 架独立战机 · 近防炮'})),
  ...CONTAINER_SHIPS.map(spec=>({spec,build:options=>createContainerShip(spec,options),icon:'🚢',type:'超大型集装箱船',description:'双岛生活区、独立波纹钢集装箱、绑扎桥与单轴推进；大浪后逐箱滑落并漂浮。',load:'80% 货箱逐个释放 · 海上漂浮'})),
  ...CRUISE_SHIPS.map(spec=>({spec,build:options=>createCruiseShip(spec,options),icon:'🛳',type:'大型邮轮',description:spec.iconClass?'AquaDome 玻璃穹顶、开放中央花园、水上乐园、独立阳台和救生艇。':'开放中央花园、舰艉水上剧场、双干滑道、逐层阳台与救生艇。',load:'细致玻璃窗与阳台 · 三轴推进'})),
];
export const FLEET_BY_ID=Object.fromEntries(FLEET.map(entry=>[entry.spec.id,entry]));

export const COMBAT_FLEET=FLEET.filter(entry=>entry.combat);
