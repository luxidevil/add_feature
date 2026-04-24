#!/bin/bash

SSH_PASS="${DROPLET_SSH_PASSWORD}"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=15 -o ServerAliveInterval=10"

DASHBOARD_IP="68.183.28.137"
TR_IP="142.93.4.225"
CP_IP="159.89.172.195"
VM_IP="139.59.42.65"

remote() {
  local ip=$1
  local cmd=$2
  sshpass -p "$SSH_PASS" ssh $SSH_OPTS root@$ip "$cmd" 2>&1
}

deploy_dashboard() {
  echo "🚀 Deploying Dashboard ($DASHBOARD_IP)..."
  remote $DASHBOARD_IP "cd /root/dealer-dxb-dashboard && git pull origin main && npm install && pm2 restart dealer-dxb --update-env"
  echo ""
}

deploy_tr() {
  echo "🚀 Deploying Trigger Reset ($TR_IP)..."
  remote $TR_IP "cd /root/trigger_reset_droplet && git pull origin main && npm install && pm2 restart trigger-reset --update-env"
  echo ""
}

deploy_cp() {
  echo "🚀 Deploying Change Password ($CP_IP)..."
  remote $CP_IP "cd /root/change_password_droplet && git pull origin main && npm install && pm2 restart change-password --update-env"
  echo ""
}

deploy_vm() {
  echo "🚀 Deploying VM Email ($VM_IP)..."
  remote $VM_IP "cd /root/check_email_droplet && git pull origin main && npm install && pm2 restart check-email --update-env"
  echo ""
}

restart_tr() {
  echo "🔄 Restarting Trigger Reset ($TR_IP)..."
  remote $TR_IP "pm2 restart trigger-reset && pm2 logs trigger-reset --lines 10 --nostream"
  echo ""
}

restart_cp() {
  echo "🔄 Restarting Change Password ($CP_IP)..."
  remote $CP_IP "pm2 restart change-password && pm2 logs change-password --lines 10 --nostream"
  echo ""
}

restart_vm() {
  echo "🔄 Restarting VM Email ($VM_IP)..."
  remote $VM_IP "pm2 restart check-email && pm2 logs check-email --lines 10 --nostream"
  echo ""
}

status_all() {
  echo "📋 Dashboard ($DASHBOARD_IP):"
  remote $DASHBOARD_IP "pm2 list"
  echo ""
  echo "📋 Trigger Reset ($TR_IP):"
  remote $TR_IP "pm2 list"
  echo ""
  echo "📋 Change Password ($CP_IP):"
  remote $CP_IP "pm2 list"
  echo ""
  echo "📋 VM Email ($VM_IP):"
  remote $VM_IP "pm2 list"
}

logs_tr() {
  echo "📋 Trigger Reset Logs ($TR_IP):"
  remote $TR_IP "pm2 logs trigger-reset --lines ${1:-30} --nostream"
}

logs_cp() {
  echo "📋 Change Password Logs ($CP_IP):"
  remote $CP_IP "pm2 logs change-password --lines ${1:-30} --nostream"
}

logs_vm() {
  echo "📋 VM Email Logs ($VM_IP):"
  remote $VM_IP "pm2 logs check-email --lines ${1:-30} --nostream"
}

logs_dashboard() {
  echo "📋 Dashboard Logs ($DASHBOARD_IP):"
  remote $DASHBOARD_IP "pm2 logs dealer-dxb --lines ${1:-30} --nostream"
}

case "$1" in
  all)
    deploy_dashboard
    deploy_tr
    deploy_cp
    deploy_vm
    echo "✅ All servers deployed!"
    ;;
  dashboard) deploy_dashboard ;;
  tr) deploy_tr ;;
  cp) deploy_cp ;;
  vm) deploy_vm ;;
  restart-tr) restart_tr ;;
  restart-cp) restart_cp ;;
  restart-vm) restart_vm ;;
  restart-all)
    restart_tr
    restart_cp
    restart_vm
    echo "✅ All droplets restarted!"
    ;;
  status) status_all ;;
  logs-tr) logs_tr $2 ;;
  logs-cp) logs_cp $2 ;;
  logs-vm) logs_vm $2 ;;
  logs-dashboard) logs_dashboard $2 ;;
  *)
    echo "DEALER-DXB Deploy Tool"
    echo ""
    echo "Usage: bash deploy.sh <command>"
    echo ""
    echo "Deploy:"
    echo "  all          Deploy everything (dashboard + all droplets)"
    echo "  dashboard    Deploy dashboard only"
    echo "  tr           Deploy Trigger Reset droplet"
    echo "  cp           Deploy Change Password droplet"
    echo "  vm           Deploy VM Email droplet"
    echo ""
    echo "Restart:"
    echo "  restart-tr   Restart Trigger Reset"
    echo "  restart-cp   Restart Change Password"
    echo "  restart-vm   Restart VM Email"
    echo "  restart-all  Restart all droplets"
    echo ""
    echo "Monitor:"
    echo "  status       Show PM2 status on all servers"
    echo "  logs-tr      Show Trigger Reset logs"
    echo "  logs-cp      Show Change Password logs"
    echo "  logs-vm      Show VM Email logs"
    echo "  logs-dashboard  Show Dashboard logs"
    ;;
esac
