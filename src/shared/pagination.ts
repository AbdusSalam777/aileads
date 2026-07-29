export type PaginationQuery = {
  page?: number;
  limit?: number;
};

export const getPagination = ({ page = 1, limit = 20 }: PaginationQuery) => {
  const normalizedPage = Math.max(page, 1);
  const normalizedLimit = Math.min(Math.max(limit, 1), 100);

  return {
    page: normalizedPage,
    limit: normalizedLimit,
    skip: (normalizedPage - 1) * normalizedLimit,
  };
};
