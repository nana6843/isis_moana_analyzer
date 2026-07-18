from django.urls import path
from .views import ListRoutersView, FindPathsView, TopologyView, RefreshLSDBView

urlpatterns = [
    path('routers/',  ListRoutersView.as_view()),
    path('paths/',    FindPathsView.as_view()),
    path('topology/', TopologyView.as_view()),

    path('refresh/',  RefreshLSDBView.as_view()),
]