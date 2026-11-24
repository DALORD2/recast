import React from 'react';

const paths = {
  ArrowDownToLine: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>,
  ArrowLeft: <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
  ArrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  Check: <path d="m5 12 4 4L19 6" />,
  CheckCircle2: <><circle cx="12" cy="12" r="10" /><path d="m8 12 2.5 2.5L16 9" /></>,
  Clapperboard: <><path d="M4 4h16v16H4zM4 9h16M8 4l3 5m2-5 3 5m2-5 3 5" /><path d="M8 14v4m4-4v4m4-4v4" /></>,
  Clock3: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  Film: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18m10-18v18M3 8h4m-4 8h4m10-8h4m-4 8h4" /></>,
  FileText: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8m-8 4h8" /></>,
  LoaderCircle: <><path d="M21 12a9 9 0 1 1-6.2-8.56" /></>,
  LockKeyhole: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4m-5 5v2" /></>,
  LogOut: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5m5 5H9" /></>,
  MessageSquareText: <><path d="M21 15a4 4 0 0 1-4 4H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /><path d="M8 9h8m-8 4h6" /></>,
  MoreHorizontal: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  Play: <path d="m7 4 14 8-14 8z" />,
  Plus: <><path d="M12 5v14m-7-7h14" /></>,
  RefreshCw: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></>,
  Scissors: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="m8.1 8.1 12 12M14 6l-3.5 3.5M8.1 15.9 12 12m0 0 8-8" /></>,
  ShieldCheck: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11" /><path d="m9 12 2 2 4-4" /></>,
  Sparkles: <><path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2zM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2z" /></>,
  Upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5m5-5v12" /></>,
  Users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  WandSparkles: <><path d="m15 4 5 5L8 21l-5-5zM14 5l5 5M3 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1zm16 12 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" /></>,
  X: <><path d="m18 6-12 12M6 6l12 12" /></>
};

function createIcon(name) {
  function Icon({ size = 24, className, fill, strokeWidth = 2, ...props }) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={fill || 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>{paths[name]}</svg>;
  }
  Icon.displayName = name;
  return Icon;
}

export const ArrowDownToLine = createIcon('ArrowDownToLine');
export const ArrowLeft = createIcon('ArrowLeft');
export const ArrowRight = createIcon('ArrowRight');
export const Check = createIcon('Check');
export const CheckCircle2 = createIcon('CheckCircle2');
export const Clapperboard = createIcon('Clapperboard');
export const Clock3 = createIcon('Clock3');
export const Film = createIcon('Film');
export const FileText = createIcon('FileText');
export const LoaderCircle = createIcon('LoaderCircle');
export const LockKeyhole = createIcon('LockKeyhole');
export const LogOut = createIcon('LogOut');
export const MessageSquareText = createIcon('MessageSquareText');
export const MoreHorizontal = createIcon('MoreHorizontal');
export const Play = createIcon('Play');
export const Plus = createIcon('Plus');
export const RefreshCw = createIcon('RefreshCw');
export const Scissors = createIcon('Scissors');
export const ShieldCheck = createIcon('ShieldCheck');
export const Sparkles = createIcon('Sparkles');
export const Upload = createIcon('Upload');
export const Users = createIcon('Users');
export const WandSparkles = createIcon('WandSparkles');
export const X = createIcon('X');
