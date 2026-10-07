/** UI, cycling and camera acceptance consume the same vessel capabilities. */
export const CAMERA_MODES=Object.freeze(['orbit','chase','bridge','deck','cinema','walk']);
export const cameraModes=vessel=>vessel.cameras??CAMERA_MODES;
