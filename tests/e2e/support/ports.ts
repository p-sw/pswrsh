// The live service may own 3000/3101, so a run can pick other ports.
export const APP_PORT = Number(process.env.PSWRSH_TEST_PORT ?? 3000);
export const GATEWAY_PORT = Number(process.env.PSWRSH_TEST_GATEWAY_PORT ?? 3101);
export const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
