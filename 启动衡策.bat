@echo off
chcp 65001 >nul
title 衡策 - 项目考察与反向投资决策系统
cd /d "%~dp0"

REM 定位 Node/npm：优先系统 PATH，其次本机 Kimi 内置运行时
set "NPM=npm"
where npm >nul 2>nul
if errorlevel 1 (
  if exist "%LOCALAPPDATA%\Programs\Kimi\resources\resources\runtime\npm.cmd" (
    set "PATH=%LOCALAPPDATA%\Programs\Kimi\resources\resources\runtime;%PATH%"
  ) else (
    echo 未找到 Node.js。请先安装 Node.js 20+：https://nodejs.org/
    pause
    exit /b 1
  )
)

REM 检查 3000 端口是否已有服务在运行，避免重复启动
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo 衡策服务已在运行，直接打开浏览器...
  start "" http://localhost:3000
  exit /b 0
)

REM 首次使用或依赖缺失时自动安装
if not exist node_modules (
  echo 首次运行，正在安装依赖（中国大陆网络自动使用镜像源）...
  call npm install --registry=https://registry.npmmirror.com
)

REM 首次使用先构建生产版本
if not exist .next (
  echo 首次运行，正在构建...
  call npm run build
)

echo 正在启动衡策... 浏览器将自动打开，关闭本窗口即停止服务。
start "" http://localhost:3000
call npm start
