@echo off
title Dijital Rehberlik ve Güvenlik Sistemi
cd /d "C:\Users\pelif\OneDrive\Desktop\proje"
echo ===================================================
echo   Dijital Rehberlik ve Guvenlik Asistani Baslatiliyor
echo ===================================================
echo [BILGI] Uygulama Masaustunde ve Web Sunucusunda Calisiyor.
echo [MOBIL] Ayni Wi-Fi uzerindeki telefonunuzdan baglanmak icin:
echo         http://localhost:3000 veya bilgisayarinizin yerel IP adresi:3000
echo ===================================================
call npm start
if %errorlevel% neq 0 pause
