/** Combat tuning is independent of hull geometry and controller identity. */
export const COMBAT_CLASSES = Object.freeze({
  enterprise: {health:15000}, nimitz: {health:15000}, ford: {health:17000},
  chineseCarrier: {health:14000}, iowa: {health:12000,salvo:true},
  yamato: {health:13000,salvo:true}, destroyer: {health:9000,missiles:20},
  missileBoat: {health:6000}, submarine: {health:10000,missiles:20},
});
export const COMBAT_RULES = Object.freeze({
  gun:{interval:60/40,damage:500,speed:900,range:4500},
  salvo:{interval:5,damage:2000,speed:900,range:4500},
  ciws:{interval:.05,damagePerSecond:200,hotSeconds:10,coolSeconds:5,speed:1100,range:3200},
  missile:{interval:1.5,damage:1500,speed:400,range:6500,turnRate:2.4},
  steering:{rudderAt:(_angle,target)=>target,yawRate:.48,yawResponse:20},
});
export function combatProfile(entry){
  const hull=COMBAT_CLASSES[entry.combat];
  const main=entry.spec.weapons.filter(w=>w.type==='main');
  return {...hull,mainBarrels:main.reduce((n,w)=>n+w.barrels,0),
    ciwsMounts:entry.spec.weapons.filter(w=>w.type==='ciws').length,
    main:hull.salvo?COMBAT_RULES.salvo:COMBAT_RULES.gun};
}
export const wrapAngle=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
