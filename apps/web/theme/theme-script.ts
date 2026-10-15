import { DARK_MEDIA_QUERY, SYSTEM_THEME_COOKIE, THEME_COOKIE, themeModes, type ThemeMode } from './theme-mode';

/**
 * Runs in <head> before the first paint. The server already renders the theme from cookies;
 * this covers the first visit (no cookie yet) and "system" mode, and records the OS preference
 * for the next server render. It also adopts the choice the earlier theme toggle kept in localStorage.
 */
export function themeInitScript(defaultMode: ThemeMode): string {
  return `(function(){try{
var d=document.documentElement;
function get(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null}
function set(n,v){document.cookie=n+"="+v+"; path=/; max-age=31536000; SameSite=Lax"}
var sys=matchMedia(${JSON.stringify(DARK_MEDIA_QUERY)}).matches?"dark":"light";
set(${JSON.stringify(SYSTEM_THEME_COOKIE)},sys);
var mode=get(${JSON.stringify(THEME_COOKIE)});
if(${JSON.stringify(themeModes)}.indexOf(mode)<0){
var legacy=localStorage.getItem("theme");
if(legacy==="dark"||legacy==="light"){mode=legacy;set(${JSON.stringify(THEME_COOKIE)},mode)}else{mode=${JSON.stringify(defaultMode)}}
localStorage.removeItem("theme");
}
d.classList.toggle("dark",(mode==="system"?sys:mode)==="dark");
}catch(e){}})()`;
}
