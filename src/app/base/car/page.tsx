'use client';
// Статичний експорт: динамічні маршрути без generateStaticParams не працюють,
// тому ID авто передається параметром ?id=…
import { useSearchParams } from 'next/navigation';
import { VehicleDetailView } from '../../../components/base/VehicleDetailView';

export default function CarPage() {
  const id = useSearchParams().get('id');
  return <VehicleDetailView id={id} />;
}
