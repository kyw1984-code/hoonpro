import React from 'react';

const Skeleton = ({ className }: { className?: string }) => (
  <div className={`animate-pulse bg-gray-200 rounded-md ${className}`} />
);

export const ProductSkeleton = () => (
  <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
    <Skeleton className="w-full aspect-square rounded-xl mb-4" />
    <Skeleton className="w-3/4 h-5 mb-2" />
    <Skeleton className="w-1/2 h-4 mb-4" />
    <div className="flex justify-between items-center">
      <Skeleton className="w-1/3 h-6" />
      <Skeleton className="w-1/4 h-8 rounded-full" />
    </div>
  </div>
);

export default Skeleton;
