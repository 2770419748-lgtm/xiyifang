import { store } from '../store.js';
import { fmtTime, itemsText, money, screen } from '../utils.js';

// 订单列表：电脑端为表格，手机端为卡片
export const OrderList = {
  props: {
    orders: { type: Array, required: true },
    showCustomer: { type: Boolean, default: true },
    loading: Boolean,
  },
  emits: ['open'],
  setup() {
    return { store, screen, fmtTime, itemsText, money };
  },
  template: `
  <div :class="{ refetching: loading }">
    <div v-if="!orders.length" class="empty"><Icon name="search" :size="32"/>{{ loading ? '加载中…' : '没有找到订单' }}</div>
    <div v-else-if="screen.mobile" class="list">
      <div v-for="o in orders" :key="o.id" class="list-item" @click="$emit('open', o)">
        <div class="grow">
          <div class="list-title">
            <template v-if="showCustomer">
              <span class="ellipsis">{{ o.customer_name }}</span><span class="code-badge">{{ o.customer_code }}</span>
            </template>
            <span v-else class="order-no">{{ o.order_no }}</span>
            <span class="spacer"></span>
            <StatusTag :status="o.status"/>
          </div>
          <div class="list-sub">
            {{ itemsText(o.items) }} · 共 {{ o.total_qty }} 件<template v-if="store.settings.enable_price"> · {{ money(o.amount) }}</template>
          </div>
          <div class="list-sub muted">
            送 {{ fmtTime(o.received_at) }}<template v-if="o.picked_at"> · 取 {{ fmtTime(o.picked_at) }}</template><template v-if="showCustomer"> · {{ o.order_no }}</template>
          </div>
        </div>
        <Icon name="chevronRight" :size="18" class="muted"/>
      </div>
    </div>
    <div v-else class="table-wrap">
      <table class="table clickable">
        <thead>
          <tr>
            <th>单号</th>
            <th v-if="showCustomer">客户</th>
            <th>物品</th>
            <th class="num">件数</th>
            <th v-if="store.settings.enable_price" class="num">金额</th>
            <th>送来时间</th>
            <th>取走时间</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in orders" :key="o.id" @click="$emit('open', o)">
            <td class="order-no nowrap">{{ o.order_no }}</td>
            <td v-if="showCustomer" class="nowrap">{{ o.customer_name }} <span class="code-badge">{{ o.customer_code }}</span>
              <span v-if="o.customer_member_type === 'package'" class="tag info plain">包期</span></td>
            <td>{{ itemsText(o.items) }}</td>
            <td class="num">{{ o.total_qty }}</td>
            <td v-if="store.settings.enable_price" class="num">{{ money(o.amount) }}</td>
            <td class="nowrap">{{ fmtTime(o.received_at) }}</td>
            <td class="nowrap">{{ o.picked_at ? fmtTime(o.picked_at) : '—' }}</td>
            <td><StatusTag :status="o.status"/></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`,
};
