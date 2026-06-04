export {
  createDraftSale,
  addItemToSale,
  updateItemQuantity,
  removeItemFromSale,
  setSaleCustomer,
  finalizeSale,
  cancelSale,
  getSaleWithItems,
  listRecentSales,
  listTodaySales,
  type SaleWithItems,
} from './sale.service.js';

export type {
  AddItemInput,
  UpdateItemQuantityInput,
  RemoveItemInput,
  SetCustomerInput,
  FinalizeSaleInput,
  CancelSaleInput,
} from './types.js';

export {
  AddItemInputSchema,
  UpdateItemQuantityInputSchema,
  RemoveItemInputSchema,
  SetCustomerInputSchema,
  FinalizeSaleInputSchema,
  CancelSaleInputSchema,
} from './types.js';
