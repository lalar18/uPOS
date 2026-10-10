<template>
  <!-- Online payments are processed by PayMongo; showing it tells the customer who's taking the payment -->
  <span class="secured fs-12 text-gray-5">
    <i class="ti ti-lock" aria-hidden="true"></i>Secured by
    <img src="/assets/img/payments/paymongo.svg" alt="PayMongo" draggable="false" />
  </span>
</template>

<style scoped>
.secured {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.secured img {
  width: auto;
  height: 14px;
}
</style>
