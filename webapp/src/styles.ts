export const styles=`
.vrr-anchor{display:block;line-height:1.3}
.vrr-badge{display:inline-flex;align-items:center;gap:5px;margin:4px 0 0;padding:3px 7px;border:1px solid rgba(var(--center-channel-color-rgb,63,67,80),.15);border-radius:12px;background:transparent;color:var(--center-channel-color,#3f4350);font-size:12px;line-height:18px;cursor:pointer;font-family:inherit}
button.vrr-badge:hover{background:rgba(var(--center-channel-color-rgb,63,67,80),.08)}
.vrr-badge-static{cursor:default;opacity:.75}
.vrr-badge:focus-visible,.vrr-dialog button:focus-visible{outline:2px solid var(--button-bg,#166de0);outline-offset:2px}
.vrr-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px;color:var(--center-channel-color,#3f4350);font-family:inherit}
.vrr-dialog{background:var(--center-channel-bg,#fff);border-radius:12px;box-shadow:0 12px 50px rgba(0,0,0,.2);width:440px;max-width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:24px}
.vrr-dialog-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
.vrr-dialog h2{display:flex;align-items:center;gap:8px;font-size:18px;margin:0;font-weight:600}
.vrr-dialog button{border:0;background:transparent;color:inherit;cursor:pointer;font-family:inherit}
.vrr-dialog-header button{font-size:26px;padding:0 6px;line-height:30px}
.vrr-description,.vrr-footnote{font-size:12px;line-height:1.7;opacity:.8;margin:16px 0}
.vrr-footnote{margin-bottom:0}
.vrr-readers{max-height:280px;overflow:auto;border-top:1px solid rgba(var(--center-channel-color-rgb,63,67,80),.15);border-bottom:1px solid rgba(var(--center-channel-color-rgb,63,67,80),.15);padding:6px 0}
.vrr-readers ul{list-style:none;padding:0;margin:0}
.vrr-readers li{display:flex;align-items:center;gap:12px;padding:10px 2px}
.vrr-readers strong{display:block;font-size:14px;font-weight:600}
.vrr-readers small{display:block;font-size:12px;opacity:.65;margin-top:2px}
.vrr-avatar{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:rgba(var(--center-channel-color-rgb,63,67,80),.08);font-size:14px;flex-shrink:0}
`;
