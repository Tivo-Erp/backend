/**
 * Vietnamese Chart of Accounts (Circular 200/2014/TT-BTC).
 * Seeded on tenant registration and re-seedable via the COA seed endpoint.
 */
export interface SeedAccount {
  accountCode: string;
  accountName: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normalBalance: 'debit' | 'credit';
  isGroup: boolean;
  parentCode?: string;
}

export const CHART_OF_ACCOUNTS_VN: SeedAccount[] = [
  // Assets (Loại 1, 2)
  {
    accountCode: '111',
    accountName: 'Tiền mặt',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '112',
    accountName: 'Tiền gửi ngân hàng',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '131',
    accountName: 'Phải thu khách hàng',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '133',
    accountName: 'Thuế GTGT được khấu trừ',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: true,
  },
  {
    accountCode: '1331',
    accountName: 'Thuế GTGT đầu vào của hàng hóa, dịch vụ',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
    parentCode: '133',
  },
  {
    accountCode: '152',
    accountName: 'Nguyên liệu, vật liệu',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '153',
    accountName: 'Công cụ, dụng cụ',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '154',
    accountName: 'Chi phí SXKD dở dang',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '155',
    accountName: 'Thành phẩm',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '156',
    accountName: 'Hàng hóa',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '211',
    accountName: 'TSCĐ hữu hình',
    accountType: 'asset',
    normalBalance: 'debit',
    isGroup: true,
  },
  {
    accountCode: '2141',
    accountName: 'Hao mòn TSCĐ hữu hình',
    accountType: 'asset',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '211',
  },
  // Liabilities (Loại 3)
  {
    accountCode: '331',
    accountName: 'Phải trả người bán',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
  },
  {
    accountCode: '333',
    accountName: 'Thuế và các khoản phải nộp',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: true,
  },
  {
    accountCode: '3331',
    accountName: 'Thuế GTGT đầu ra',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '333',
  },
  {
    accountCode: '3335',
    accountName: 'Thuế TNCN',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '333',
  },
  {
    accountCode: '334',
    accountName: 'Phải trả người lao động',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
  },
  {
    accountCode: '338',
    accountName: 'Phải trả phải nộp khác',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: true,
  },
  {
    accountCode: '3383',
    accountName: 'BHXH',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '338',
  },
  {
    accountCode: '3384',
    accountName: 'BHYT',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '338',
  },
  {
    accountCode: '3386',
    accountName: 'BHTN',
    accountType: 'liability',
    normalBalance: 'credit',
    isGroup: false,
    parentCode: '338',
  },
  // Equity (Loại 4)
  {
    accountCode: '411',
    accountName: 'Vốn đầu tư của chủ sở hữu',
    accountType: 'equity',
    normalBalance: 'credit',
    isGroup: false,
  },
  {
    accountCode: '421',
    accountName: 'Lợi nhuận sau thuế chưa phân phối',
    accountType: 'equity',
    normalBalance: 'credit',
    isGroup: false,
  },
  // Revenue (Loại 5)
  {
    accountCode: '511',
    accountName: 'Doanh thu bán hàng',
    accountType: 'revenue',
    normalBalance: 'credit',
    isGroup: false,
  },
  // Other income (Loại 7) — e.g. gain on asset disposal
  {
    accountCode: '711',
    accountName: 'Thu nhập khác',
    accountType: 'revenue',
    normalBalance: 'credit',
    isGroup: false,
  },
  // Expenses (Loại 6)
  {
    accountCode: '621',
    accountName: 'Chi phí NVL trực tiếp',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '622',
    accountName: 'Chi phí nhân công trực tiếp',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '627',
    accountName: 'Chi phí sản xuất chung',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '632',
    accountName: 'Giá vốn hàng bán',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '641',
    accountName: 'Chi phí bán hàng',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  {
    accountCode: '642',
    accountName: 'Chi phí quản lý doanh nghiệp',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
  // Other expenses (Loại 8) — e.g. loss on asset disposal
  {
    accountCode: '811',
    accountName: 'Chi phí khác',
    accountType: 'expense',
    normalBalance: 'debit',
    isGroup: false,
  },
];
