from django.urls import path
from .views import ListRoutersView, FindPathsView, TopologyView, RefreshLSDBView, wan_ip_list

urlpatterns = [
    path('routers/',  ListRoutersView.as_view()),
    path('paths/',    FindPathsView.as_view()),
    path('topology/', TopologyView.as_view()),

    path('refresh/',  RefreshLSDBView.as_view()),
    path('wan-ips/', wan_ip_list)

    
]