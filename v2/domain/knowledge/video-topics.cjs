'use strict';
// Video browse topics only; titles locate operations, never establish compatibility.
function videoTopic(name=''){
 if(/节目|program/i.test(name)&&/更新|update|U盘|Udisk|发送|send/i.test(name))return '节目制作与发布';
 if(/固件|烧录|升级|刷机|线刷|OTA|firmware|upgrade|the update of M20/i.test(name))return '固件升级与烧录';
 if(/复位|恢复出厂|reset/i.test(name))return '复位与恢复出厂';
 if(/Wi.?Fi|热点|固定\s*IP|IP地址|网段|联网|配网|网络|路由|Station|network|局域网/i.test(name))return '网络连接与配置';
 if(/拼接|同步|投屏|多屏|镜像|开窗|两画面|多画面|多窗口|multi.screen|synchron|multi.window/i.test(name))return '拼接、同步与多画面';
 if(/ADB|开发|APK|应用安装|安装软件|软件安装|环境搭建|日志|Read back log/i.test(name))return '安装、开发与日志';
 if(/屏参|调试|亮度|旋转|分辨率|遥控|LOGO|开机画面|启动画面|校正|校准|calibrat/i.test(name))return '调试与显示设置';
 if(/节目|播放|发布|转码|插播|program|playback/i.test(name))return '节目制作与发布';
 return '基础操作与设置';
}
const topicOrder=['固件升级与烧录','调试与显示设置','复位与恢复出厂','网络连接与配置','节目制作与发布','拼接、同步与多画面','安装、开发与日志','基础操作与设置'];
module.exports={videoTopic,topicOrder};
