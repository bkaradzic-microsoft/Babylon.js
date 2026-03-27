@echo off

call npx nx run babylonjs:build
call npx nx run babylonjs-loaders:build
call npx nx run babylonjs-materials:build
call npx nx run babylonjs-gui:build
call npx nx run babylonjs-serializers:build

call npm link -w babylonjs
call npm link -w babylonjs-loaders
call npm link -w babylonjs-materials
call npm link -w babylonjs-gui
call npm link -w babylonjs-serializers
