/** A continuous operating envelope limits commanded propulsion, never wave
 * heave or hull attitude. Zero sea height retains the calm-water rating. */
export function propulsionSpeedLimit(dynamics,seaHeight){
  const envelope=dynamics.seaSpeed;
  if(!envelope)return dynamics.speedLimit??60;
  const t=Math.min(1,Math.max(0,seaHeight/envelope.height)),blend=t*t*(3-2*t);
  return dynamics.speedLimit+(envelope.speed-dynamics.speedLimit)*blend;
}

/** The governor balances an overspeed with a finite propulsive braking
 * force. Acceleration remains force / mass and speed is never teleported. */
export function propulsionForce(dynamics,throttle,speed,seaHeight){
  const limit=propulsionSpeedLimit(dynamics,seaHeight);
  const free=dynamics.seaSpeed?limit:dynamics.freeSpeed;
  const forward=throttle>0?throttle*dynamics.thrust*Math.max(0,1-Math.max(0,speed)/free):throttle*dynamics.thrust*.42;
  const brake=dynamics.seaSpeed?dynamics.thrust*Math.max(0,(speed-limit)/Math.max(1,limit*.12)):0;
  return forward-brake;
}
