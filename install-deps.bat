@echo off
echo ===================================
echo 安装 DataSet Tool 依赖
echo ===================================
echo.

echo 1. 安装 Less 和 Less Loader...
call npm install -D less less-loader

echo.
echo 2. 安装自动导入插件...
call npm install -D unplugin-auto-import unplugin-vue-components

echo.
echo 3. 安装 VueUse 和 Zod...
call npm install @vueuse/core zod

echo.
echo 4. 安装 Element Plus 解析器...
call npm install -D @element-plus/icons-vue

echo.
echo ===================================
echo 安装完成！
echo ===================================
echo.
echo 现在可以运行：npm run dev
echo.
pause
